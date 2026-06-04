module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });

    const { image, filename } = body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const clientEmail = process.env.DRIVE_CLIENT_EMAIL;
    const folderId    = '1n0olOzv8niL7AxpoC8plZFFqnXmwmJlR';

    // Handle private key — รองรับทั้ง \n literal และ newline จริง
    let privateKey = process.env.DRIVE_PRIVATE_KEY || '';
    // ถ้ายังเป็น \n literal ให้แปลงเป็น newline จริง
    if (privateKey.indexOf('\\n') !== -1) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    // ถ้า key ไม่มี header ให้เพิ่มเข้าไป
    if (!privateKey.includes('-----BEGIN')) {
      return res.status(500).json({ error: 'Invalid private key format' });
    }

    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Drive credentials not configured' });
    }

    // 1. สร้าง JWT
    const jwt = await makeJWT(clientEmail, privateKey);

    // 2. แลก JWT เป็น Access Token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ error: 'Failed to get access token', detail: tokenData });
    }
    const accessToken = tokenData.access_token;

    // 3. แปลง base64 ด้วย Buffer
    const base64    = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType  = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const imgBuf    = Buffer.from(base64, 'base64');

    // 4. Upload multipart
    const fname    = filename || ('bcard_' + Date.now() + '.jpg');
    const metadata = JSON.stringify({ name: fname });
    const boundary = 'boundary_propak2026';

    const part1 = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      metadata + '\r\n', 'utf8'
    );
    const part2 = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Type: ' + mimeType + '\r\n\r\n', 'utf8'
    );
    const part3 = Buffer.from('\r\n--' + boundary + '--', 'utf8');
    const multipart = Buffer.concat([part1, part2, imgBuf, part3]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'multipart/related; boundary=' + boundary,
          'Content-Length': String(multipart.length),
        },
        body: multipart,
      }
    );
    const uploadData = await uploadRes.json();
    if (!uploadData.id) {
      return res.status(500).json({ error: 'Upload failed', detail: uploadData });
    }

    // 5. ทำให้ public
    await fetch('https://www.googleapis.com/drive/v3/files/' + uploadData.id + '/permissions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    const directLink = 'https://drive.google.com/uc?export=view&id=' + uploadData.id;
    const viewLink   = 'https://drive.google.com/file/d/' + uploadData.id + '/view';

    return res.status(200).json({ status: 'ok', fileId: uploadData.id, viewLink, directLink });

  } catch(err) {
    console.error('Drive upload error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

async function makeJWT(clientEmail, privateKey) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = toBase64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const sigInput  = header + '.' + payload;
  const signature = await rsaSign(sigInput, privateKey);
  return sigInput + '.' + signature;
}

function toBase64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function rsaSign(input, pemKey) {
  const crypto = require('crypto');
  const sign   = crypto.createSign('RSA-SHA256');
  sign.update(input);
  sign.end();
  const sig = sign.sign(pemKey);
  return sig.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
