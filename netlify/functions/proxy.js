// netlify/functions/proxy.js
// 支持：普通聊天 + Function Calling（天气查询）+ 图片识别

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { messages, imageBase64 } = body;
        const apiKey = process.env.DEEPSEEK_API_KEY;

        if (!apiKey) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing API Key' }) };
        }

        // ========== 图片识别模式（保持原有功能）==========
        if (imageBase64) {
            const userMessage = '请描述这张图片，并判断它是不是金鱼。如果是金鱼，请说出它的品种和特点；如果不是，请说明它是什么。';
            const requestBody = {
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userMessage },
                            { type: 'image_url', image_url: { url: imageBase64 } }
                        ]
                    }
                ],
                temperature: 0.7
            };

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
        }

        // ========== 正常对话模式（新增 Function Calling）==========
        
        // 1. 定义可用工具
        const tools = [
            {
                type: "function",
                function: {
                    name: "get_weather",
                    description: "获取某个城市的实时天气信息",
                    parameters: {
                        type: "object",
                        properties: {
                            city: {
                                type: "string",
                                description: "城市名称，例如：北京、上海、深圳"
                            }
                        },
                        required: ["city"]
                    }
                }
            }
        ];

        // 2. 第一次调用 DeepSeek，带 tools 参数
        let response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: messages.slice(-10),
                tools: tools,
                tool_choice: "auto",
                temperature: 0.7
            })
        });

        let data = await response.json();
        let assistantMessage = data.choices[0].message;

        // 3. 如果模型决定调用工具
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            const toolCall = assistantMessage.tool_calls[0];
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            
            let toolResult = "";
            
            if (toolName === "get_weather") {
                const city = toolArgs.city;
                try {
                    const weatherResponse = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
                    const weatherData = await weatherResponse.json();
                    const currentCondition = weatherData.current_condition[0];
                    const temp = currentCondition.temp_C;
                    const desc = currentCondition.weatherDesc[0].value;
                    toolResult = `${city}当前天气：${desc}，气温 ${temp}°C`;
                } catch (error) {
                    toolResult = `获取${city}天气失败：${error.message}`;
                }
            }
            
            // 4. 把工具结果发回给模型
            const secondMessages = [
                ...messages.slice(-10),
                assistantMessage,
                {
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toolResult
                }
            ];
            
            response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: secondMessages,
                    temperature: 0.7
                })
            });
            
            data = await response.json();
            const finalReply = data.choices[0].message.content;
            return {
                statusCode: 200,
                body: JSON.stringify({ reply: finalReply })
            };
        }
        
        // 5. 没有工具调用，直接返回
        const reply = assistantMessage.content || "抱歉，我无法回答。";
        return {
            statusCode: 200,
            body: JSON.stringify({ reply: reply })
        };

    } catch (error) {
        console.error("Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};