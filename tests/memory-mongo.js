import { randomUUID } from 'node:crypto';

function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(part => matches(document, part));
    const actual = document[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof RegExp)) {
      if ('$in' in expected && !expected.$in.includes(actual)) return false;
      if ('$gte' in expected && !(actual >= expected.$gte)) return false;
      if ('$lt' in expected && !(actual < expected.$lt)) return false;
      if ('$regex' in expected && !(new RegExp(expected.$regex, expected.$options || '').test(String(actual ?? '')))) return false;
      return true;
    }
    if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
    return actual === expected;
  });
}

function project(document, projection) {
  if (!projection) return structuredClone(document);
  const keys = Object.keys(projection).filter(key => projection[key]);
  return Object.fromEntries(keys.filter(key => key in document).map(key => [key, structuredClone(document[key])]));
}

class MemoryCollection {
  rows = new Map();
  async createIndex() { return 'test-index'; }
  async findOne(query = {}, options = {}) {
    const row = [...this.rows.values()].find(document => matches(document, query));
    return row ? project(row, options.projection) : null;
  }
  find(query = {}, options = {}) {
    let rows = [...this.rows.values()].filter(document => matches(document, query)).map(document => project(document, options.projection));
    const cursor = {
      sort(spec) { rows.sort((a, b) => { for (const [key, direction] of Object.entries(spec)) { if (a[key] === b[key]) continue; return (a[key] < b[key] ? -1 : 1) * direction; } return 0; }); return cursor; },
      skip(count) { rows = rows.slice(count); return cursor; },
      limit(count) { rows = rows.slice(0, count); return cursor; },
      async toArray() { return structuredClone(rows); }
    };
    return cursor;
  }
  async countDocuments(query = {}) { return [...this.rows.values()].filter(document => matches(document, query)).length; }
  async insertOne(document) {
    const row = { ...structuredClone(document), _id: document._id || randomUUID() };
    if (this.rows.has(row._id)) { const error = new Error('duplicate key'); error.code = 11000; throw error; }
    this.rows.set(row._id, row);
    return { insertedId: row._id };
  }
  async updateOne(filter, update, options = {}) {
    let row = [...this.rows.values()].find(document => matches(document, filter));
    const inserted = !row && options.upsert;
    if (!row && !inserted) return { matchedCount: 0, modifiedCount: 0 };
    if (!row) {
      row = Object.fromEntries(Object.entries(filter).filter(([, value]) => value === null || typeof value !== 'object'));
      row._id = filter._id || randomUUID();
    }
    Object.assign(row, structuredClone(update.$set || {}));
    if (inserted) Object.assign(row, structuredClone(update.$setOnInsert || {}));
    this.rows.set(row._id, row);
    return { matchedCount: inserted ? 0 : 1, modifiedCount: 1, upsertedCount: inserted ? 1 : 0 };
  }
  async deleteOne(filter) {
    const row = [...this.rows.values()].find(document => matches(document, filter));
    if (!row) return { deletedCount: 0 };
    this.rows.delete(row._id);
    return { deletedCount: 1 };
  }
}

export class MemoryDatabase {
  collections = new Map();
  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new MemoryCollection());
    return this.collections.get(name);
  }
  async command(command) { return command.ping ? { ok: 1 } : {}; }
}
