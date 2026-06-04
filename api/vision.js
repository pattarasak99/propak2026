module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({error:'No image provided'});

    const apiKey = process.env.VISION_API_KEY;
    if (!apiKey) return res.status(500).json({error:'No API key configured'});

    const base64 = image.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [
              {type:'DOCUMENT_TEXT_DETECTION', maxResults:1}
            ]
          }]
        })
      }
    );

    const data = await response.json();

    // ถ้า Vision API return error
    if (data.error) return res.status(500).json({status:'error', message: data.error.message});

    const text = data.responses?.[0]?.fullTextAnnotation?.text || '';
    return res.status(200).json({status:'ok', text});

  } catch(err) {
    return res.status(500).json({status:'error', message: err.message});
  }
};
