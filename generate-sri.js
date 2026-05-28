/**
 * IntegrityAI — SRI Hash Generator
 *
 * Downloads each CDN script used in index.html, computes its SHA-384 hash,
 * and patches index.html in-place with the correct integrity attribute.
 *
 * Run once from the netlify-deploy folder:
 *   node generate-sri.js
 */

const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const INDEX_HTML = path.join(__dirname, 'index.html');

// All CDN scripts that need SRI attributes
const CDN_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js',
];

function fetchBytes(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        return fetchBytes(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sha384(buf) {
  return 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
}

async function main() {
  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  let changed = 0;

  for (const url of CDN_SCRIPTS) {
    process.stdout.write(`  Fetching ${url.split('/').slice(-1)[0]} ... `);
    try {
      const buf  = await fetchBytes(url);
      const hash = sha384(buf);
      console.log(`✓  ${hash}`);

      // Match the existing <script> tag for this URL (with or without integrity already set)
      // Strategy: find the src="<url>" inside a script tag, then inject/replace integrity attr
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Pattern: <script ...src="URL"...> — may already have integrity attr we want to replace
      const tagRegex = new RegExp(
        `(<script\\b[^>]*?\\bsrc="${escapedUrl}"[^>]*?)(?:\\s+integrity="[^"]*")?([^>]*?>)`,
        'g'
      );

      const before = html;
      html = html.replace(tagRegex, (match, pre, post) => {
        // Ensure crossorigin="anonymous" is present (required for SRI to work)
        let tag = pre;
        if (!tag.includes('crossorigin')) {
          tag += ' crossorigin="anonymous"';
        }
        tag += ` integrity="${hash}"` + post;
        return tag;
      });

      if (html !== before) {
        changed++;
      } else {
        console.warn(`  ⚠  Could not find script tag for: ${url}`);
      }
    } catch (err) {
      console.error(`  ✗  FAILED: ${err.message}`);
      console.error(`     Skipping ${url} — fix manually.`);
    }
  }

  if (changed > 0) {
    fs.writeFileSync(INDEX_HTML, html, 'utf8');
    console.log(`\n✅  Patched ${changed}/${CDN_SCRIPTS.length} script tags in index.html`);
    console.log('   Review the changes, then commit:\n');
    console.log('   git diff index.html');
    console.log('   git add index.html && git commit -m "security: add SRI hashes to CDN scripts"');
  } else {
    console.log('\n⚠  No changes made — check URL patterns match your index.html');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
