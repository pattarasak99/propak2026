module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // อ่าน body
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
    const privateKey  = process.env.DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const folderId    = '0AJF7btp7WqGTUk9PVA';

    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Drive credentials not configured' });
    }

    // 1. สร้าง JWT token
    const jwt = await makeJWT(clientEmail, privateKey);

    // 2. แลก JWT เป็น Access Token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ error: 'Failed to get access token', detail: tokenData });
    }
    const accessToken = tokenData.access_token;

    // 3. แปลง base64 เป็น binary
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = image.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // 4. Upload ไป Google Drive (multipart)
    const fname = filename || `bcard_${Date.now()}.jpg`;
    const metadata = JSON.stringify({ name: fname, parents: [folderId] });
    const boundary = 'boundary_propak2026';

    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
    const dataPart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const endPart  = `\r\n--${boundary}--`;

    const metaBytes  = new TextEncoder().encode(metaPart);
    const dataHeader = new TextEncoder().encode(dataPart);
    const endBytes   = new TextEncoder().encode(endPart);

    const multipart = new Uint8Array(
      metaBytes.length + dataHeader.length + bytes.length + endBytes.length
    );
    let offset = 0;
    multipart.set(metaBytes,  offset); offset += metaBytes.length;
    multipart.set(dataHeader, offset); offset += dataHeader.length;
    multipart.set(bytes,      offset); offset += bytes.length;
    multipart.set(endBytes,   offset);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': multipart.length,
        },
        body: multipart,
      }
    );
    const uploadData = await uploadRes.json();
    if (!uploadData.id) {
      return res.status(500).json({ error: 'Upload failed', detail: uploadData });
    }

    // 5. ทำให้ไฟล์ public (anyone with link can view)
    await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    // 6. Return link
    const viewLink = `https://drive.google.com/file/d/${uploadData.id}/view`;
    const directLink = `https://drive.google.com/uc?export=view&id=${uploadData.id}`;

    return res.status(200).json({
      status: 'ok',
      fileId: uploadData.id,
      viewLink,
      directLink,
    });

  } catch(err) {
    console.error('Drive upload error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

// ══════════════════════════════════════
// JWT helper (ไม่ต้องใช้ library)
// ══════════════════════════════════════
async function makeJWT(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const sigInput = `${header}.${payload}`;
  const signature = await rsaSign(sigInput, privateKey);
  return `${sigInput}.${signature}`;
}

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function rsaSign(input, pemKey) {
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const encoder = new TextEncoder();
  const signedData = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(input)
  );
  return base64url(String.fromCharCode(...new Uint8Array(signedData)));
}
