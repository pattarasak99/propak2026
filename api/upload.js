const crypto = require('crypto');

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

    const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey     = process.env.CLOUDINARY_API_KEY;
    const apiSecret  = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({ error: 'Cloudinary credentials not configured' });
    }

    // แปลง base64
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');

    // สร้าง signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder    = 'propak2026';
    const publicId  = (filename || ('bcard_' + Date.now())).replace(/\.[^.]+$/, '');
    const sigStr    = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha256').update(sigStr).digest('hex');

    // Upload ไป Cloudinary
    const formData = new URLSearchParams();
    formData.append('file',       'data:image/jpeg;base64,' + base64);
    formData.append('api_key',    apiKey);
    formData.append('timestamp',  timestamp);
    formData.append('signature',  signature);
    formData.append('folder',     folder);
    formData.append('public_id',  publicId);

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const data = await uploadRes.json();

    if (!data.secure_url) {
      return res.status(500).json({ error: 'Upload failed', detail: data });
    }

    return res.status(200).json({
      status:     'ok',
      url:        data.secure_url,
      public_id:  data.public_id,
    });

  } catch(err) {
    console.error('Cloudinary upload error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
};
