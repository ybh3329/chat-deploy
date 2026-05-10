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
            const cleanReply = reply.replace(/\*\*/g, '');
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
            },
        {
            type: "function",
                function: {
                    name: "web_search",
                    description: "搜索互联网获取最新信息。当用户需要查询新闻、实时数据、最新事件、或者你的知识无法覆盖的内容时，使用此工具。",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "搜索关键词" }
                        },
                        required: ["query"]
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
         if (assistantMessage.content && assistantMessage.content.includes('<|DSML|>')) {
            console.log("✅ 检测到 DSML 格式");
            const dsmlContent = assistantMessage.content;
            console.log("原始内容:", dsmlContent);
            
            // 提取工具名称
            const toolNameMatch = dsmlContent.match(/invoke name="([^"]+)"/);
            // 提取 query 参数（针对 web_search）
            const queryMatch = dsmlContent.match(/parameter name="query" string="true">([^<]+)/);
            
            if (toolNameMatch && queryMatch) {
                  console.log("✅ 解析成功，工具:", toolNameMatch[1], "查询词:", queryMatch[1]);
                const toolName = toolNameMatch[1];
                const query = queryMatch[1].trim();
                
                // 构造标准的 tool_calls 对象
                assistantMessage.tool_calls = [{
                    id: 'dsml_' + Date.now(),
                    function: {
                        name: toolName,
                        arguments: JSON.stringify({ query: query })
                    }
                }];
            }else {
        console.log("❌ 解析失败，未匹配到工具名或参数");
    }
}
        // ========== DSML 解析结束 ==========

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
            else if (toolName === "web_search") {
                const query = toolArgs.query;
                console.log("🔍 开始执行 web_search，查询词:", query);
                try {
                    console.log("📡 调用火山引擎 API...");
                    const searchResponse = await fetch('https://open.feedcoopapi.com/agent_api/agent/chat/completion', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.VOLC_SEARCH_API_KEY}`
                        },
                        body: JSON.stringify({
                            query: query,
                            max_results: 5
                        })
                    });
                    console.log("📥 收到响应，状态码:", searchResponse.status);
                    const searchData = await searchResponse.json();
                    console.log("📄 搜索结果:", JSON.stringify(searchData).substring(0, 200));
                    const results = searchData.results || [];
                    if (results.length > 0) {
                        toolResult = `搜索“${query}”的结果：\n` + 
                            results.map((r, i) => `${i+1}. ${r.title}\n   ${r.snippet}\n   来源：${r.url}`).join('\n\n');
                    } else {
                        toolResult = `未找到关于“${query}”的搜索结果`;
                    }
                } catch (error) {
                    console.log("❌ 搜索失败:", error.message);
                    toolResult = `搜索失败：${error.message}`;
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
            const cleanReply = finalReply.replace(/\*\*/g, '');
            return {
                statusCode: 200,
                body: JSON.stringify({ reply: cleanReply })
            };
        }
        
        // 5. 没有工具调用，直接返回
        const reply = assistantMessage.content || "抱歉，我无法回答。";
        const cleanReply = reply.replace(/\*\*/g, '');
        return {
            statusCode: 200,
            body: JSON.stringify({ reply: cleanReply })
        };

    } catch (error) {
        console.error("Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};