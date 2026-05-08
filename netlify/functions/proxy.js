exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = event.headers.authorization?.replace('Bearer ', '');

  if (!apiKey) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing API Key' }) };
  }

  try {
    const { messages } = JSON.parse(event.body);

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'DeepSeek API Error');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        reply: data.choices[0].message.content 
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};