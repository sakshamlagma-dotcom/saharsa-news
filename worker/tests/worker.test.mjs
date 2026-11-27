import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyLocation, createCloudinaryUploadSignature, discover, extractFeedImage, parseFeedItems, safeImageUrl, safeRemoteUrl } from '../src/index.js';

test('Cloudinary signed upload remains compatible with direct browser uploads',async()=>{
  const result=await createCloudinaryUploadSignature({cloudName:'sample-cloud',apiKey:'sample-key',apiSecret:'test-secret',timestamp:1730000000});
  const signature=createHash('sha1').update('folder=saharsa-news&timestamp=1730000000test-secret').digest('hex');
  assert.deepEqual(result,{cloudName:'sample-cloud',apiKey:'sample-key',timestamp:1730000000,folder:'saharsa-news',signature});
});

test('location classification finds Saharsa blocks and flags sensitive stories',()=>{
  assert.equal(classifyLocation('सिमरी बख्तियारपुर में विद्यालय अपडेट').location,'Simri Bakhtiyarpur');
  const accident=classifyLocation('सहरसा शहर में सड़क दुर्घटना की खबर');
  assert.equal(accident.relevant,true);
  assert.equal(accident.sensitive,true);
  assert.equal(accident.category,'अपराध');
});

test('irrelevant RSS items are not classified as district news',()=>{
  assert.equal(classifyLocation('चेन्नई में क्रिकेट प्रतियोगिता').relevant,false);
});

test('RSS and Atom feeds yield items without publishing them',()=>{
  const rss=parseFeedItems('<rss><channel><item><title>सहरसा सूचना</title><description>आधिकारिक सूचना</description></item></channel></rss>');
  const atom=parseFeedItems('<feed><entry><title>सहरसा अपडेट</title><summary>जिला अपडेट</summary></entry></feed>');
  assert.equal(rss.length,1);
  assert.equal(atom.length,1);
});

test('RSS and Atom image metadata is extracted and validated',()=>{
  const media=parseFeedItems('<rss><channel><item><title>सहरसा समाचार</title><link>https://news.example.test/story</link><media:content url="https://images.example.test/content.jpg" type="image/jpeg"/></item></channel></rss>');
  const thumbnail=parseFeedItems('<rss><channel><item><title>सहरसा समाचार</title><link>https://news.example.test/story</link><media:thumbnail url="https://images.example.test/thumb.jpg"/></item></channel></rss>');
  const enclosure=parseFeedItems('<rss><channel><item><title>सहरसा समाचार</title><link>https://news.example.test/story</link><enclosure url="https://images.example.test/photo.jpg" type="image/jpeg"/></item></channel></rss>');
  const description=parseFeedItems('<rss><channel><item><title>सहरसा समाचार</title><link>https://news.example.test/story</link><description><![CDATA[<img src="https://images.example.test/description.jpg">]]></description></item></channel></rss>');
  const encoded=parseFeedItems('<rss><channel><item><title>सहरसा समाचार</title><link>https://news.example.test/story</link><content:encoded><![CDATA[<img src="https://images.example.test/encoded.jpg">]]></content:encoded></item></channel></rss>');
  const atom=parseFeedItems('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>सहरसा समाचार</title><link rel="alternate" href="https://news.example.test/atom-story"/><link rel="enclosure" type="image/jpeg" href="https://images.example.test/atom.jpg"/><summary>संक्षिप्त विवरण</summary></entry></feed>');
  const atomLinked=parseFeedItems('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>सहरसा समाचार</title><link rel="alternate" href="https://news.example.test/atom-story"/><link rel="image" href="https://images.example.test/atom-link.jpg"/></entry></feed>');
  const atomContent=parseFeedItems('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>सहरसा समाचार</title><link rel="alternate" href="https://news.example.test/atom-story"/><content type="html">&lt;img src="https://images.example.test/atom-content.jpg"/&gt;</content></entry></feed>');
  assert.equal(media[0].featuredImage,'https://images.example.test/content.jpg');
  assert.equal(thumbnail[0].featuredImage,'https://images.example.test/thumb.jpg');
  assert.equal(enclosure[0].featuredImage,'https://images.example.test/photo.jpg');
  assert.equal(description[0].featuredImage,'https://images.example.test/description.jpg');
  assert.equal(encoded[0].featuredImage,'https://images.example.test/encoded.jpg');
  assert.equal(atom[0].featuredImage,'https://images.example.test/atom.jpg');
  assert.equal(atomLinked[0].featuredImage,'https://images.example.test/atom-link.jpg');
  assert.equal(atomContent[0].featuredImage,'https://images.example.test/atom-content.jpg');
  assert.equal(parseFeedItems('<rss><channel><item><title>सहरसा खबर</title></item></channel></rss>')[0].featuredImage,'');
  assert.equal(extractFeedImage({description:'<img src="javascript:alert(1)">'},'https://news.example.test/story'),'');
  assert.equal(extractFeedImage({description:'<img src="http://127.0.0.1/private.jpg">'},'https://news.example.test/story'),'');
  assert.equal(safeImageUrl('data:image/png;base64,abc'),'');
  assert.equal(safeImageUrl('https://localhost/image.jpg'),'');
});

test('discovery stores extracted images on articles and keeps them unverified',async()=>{
  class Collection {
    constructor(rows=[]){this.rows=rows}
    async findOne(query){return this.rows.find(row=>Object.entries(query).every(([key,value])=>row[key]===value))||null}
    async insertOne(row){this.rows.push(structuredClone(row));return {insertedId:row._id}}
    find(query){const collection=this;return {sort(){return this},limit(count){this.count=count;return this},async toArray(){return collection.rows.filter(row=>Object.entries(query).every(([key,value])=>row[key]===value)).slice(0,this.count)}}}
    async updateOne(query,update){const row=this.rows.find(item=>Object.entries(query).every(([key,value])=>item[key]===value));if(row)Object.assign(row,update.$set||{});return {matchedCount:row?1:0}}
  }
  const collections={
    settings:new Collection(),
    automation_jobs:new Collection(),
    news_sources:new Collection([{_id:'source-1',name:'Test Feed',url:'https://news.example.test/feed.xml',enabled:true}]),
    articles:new Collection(),
    raw_news:new Collection()
  };
  const db={collection(name){return collections[name]}};
  const xml='<rss><channel><item><title>सहरसा में विद्यालय समाचार</title><link>https://news.example.test/saharsa-school</link><description>सहरसा जिले में विद्यालय संबंधी सूचना का संक्षिप्त विवरण।</description><media:content url="https://images.example.test/school.jpg" type="image/jpeg"/></item></channel></rss>';
  const result=await discover(db,{},2,{fetchImpl:async()=>new Response(xml,{status:200})});
  assert.equal(result.added,1);
  assert.equal(collections.articles.rows[0].featuredImage,'https://images.example.test/school.jpg');
  assert.equal(collections.articles.rows[0].status,'NEEDS_VERIFICATION');
});

test('source URL validation blocks local and credential-bearing URLs',()=>{
  assert.equal(safeRemoteUrl(new URL('https://example.org/feed.xml')),true);
  assert.equal(safeRemoteUrl(new URL('http://127.0.0.1/private')),false);
  assert.equal(safeRemoteUrl(new URL('https://user:pass@example.org/feed')),false);
});
