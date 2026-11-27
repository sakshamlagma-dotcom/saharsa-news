import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocation, parseFeedItems, safeRemoteUrl } from '../src/index.js';

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

test('source URL validation blocks local and credential-bearing URLs',()=>{
  assert.equal(safeRemoteUrl(new URL('https://example.org/feed.xml')),true);
  assert.equal(safeRemoteUrl(new URL('http://127.0.0.1/private')),false);
  assert.equal(safeRemoteUrl(new URL('https://user:pass@example.org/feed')),false);
});
