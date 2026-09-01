const { put, del } = require('@vercel/blob');

// This project's Blob store issues a store id + relies on Vercel's OIDC
// token (auto-injected as VERCEL_OIDC_TOKEN when "System Environment
// Variables" is enabled for the project) instead of a static
// BLOB_READ_WRITE_TOKEN. Pass the store id explicitly so the SDK picks
// the OIDC auth path; falls through to token-based auth if a plain
// BLOB_READ_WRITE_TOKEN is ever added instead.
const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID || process.env.BLOB_STORE_ID;

function putFile(pathname, body, options) {
  return put(pathname, body, STORE_ID ? { ...options, storeId: STORE_ID } : options);
}

function delFile(url) {
  return del(url, STORE_ID ? { storeId: STORE_ID } : undefined);
}

module.exports = { putFile, delFile };
