// netlify/functions/proxy.js
// 支持文本对话 + 图片识别（金鱼专用版）

exports.handler = async (event) => {
    // 只允许 POST 请求
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { messages, imageBase64 } = body;  // ← 新增 imageBase64
        
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing API Key' }) };
        }

        // 构建发送给 DeepSeek 的消息
        let userMessage = '';
        if (messages && messages.length > 0) {
            // 文本对话模式
            userMessage = messages[messages.length - 1]?.content || '';
        } else if (imageBase64) {
            // 图片识别模式（金鱼识别专用）
            userMessage = '请描述这张图片，并判断它是不是金鱼。如果是金鱼，请说出它的品种和特点；如果不是，请说明它是什么。';
        }

        // 准备请求 DeepSeek 的 body
        let requestBody = {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'user',
                    content: imageBase64 
                        ? [
                            { type: 'text', text: userMessage },
                            { type: 'image_url', image_url: { url: imageBase64 } }
                          ]
                        : userMessage
                }
            ],
            temperature: 0.7
        };

        // 如果有对话历史，使用历史（保留最近10条）
        if (messages && messages.length > 0 && !imageBase64) {
            requestBody.messages = messages.slice(-10);
        }

        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || '抱歉，我无法识别这张图片。';

        return {
            statusCode: 200,
            body: JSON.stringify({ reply: reply })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};