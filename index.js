import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { eventSource, event_types } from "../../../../script.js";
import { margeStructPromptChatLog, structPromptToSingle } from "../../../../scripts/extensions/third-party/fount/src/public/shells/chat/src/server/prompt_struct.mjs";

// 插件名称，与文件夹名一致
const extensionName = "prompt-exporter";
// 日志前缀，用于调试输出
const logPrefix = `[${extensionName}]`;
// 导出的JSON文件存储位置
let lastPromptStruct = null;
let exportCount = 0;

// 默认设置
const defaultSettings = {
    enabled: true,
    autoExport: false,
    debugMode: true,  // 默认开启调试模式方便排查
    prettyPrint: true,  // 格式化JSON输出
    interceptMode: true // 使用拦截模式捕获数据
};

// 日志函数
function logDebug(...args) {
    if (extension_settings[extensionName]?.debugMode) {
        console.log(logPrefix, "(DEBUG)", ...args);
    }
}

function logInfo(...args) {
    console.log(logPrefix, ...args);
}

function logWarning(...args) {
    console.warn(logPrefix, ...args);
}

function logError(...args) {
    console.error(logPrefix, ...args);
}

// 安全地检查对象结构
function inspectObject(obj, path = '', maxDepth = 2, currentDepth = 0) {
    try {
        if (currentDepth > maxDepth) return `[达到最大深度${maxDepth}]`;
        
        if (obj === null) return 'null';
        if (obj === undefined) return 'undefined';
        if (typeof obj !== 'object') return `${typeof obj}: ${String(obj).substring(0, 50)}`;
        
        if (Array.isArray(obj)) {
            const info = `数组[${obj.length}]`;
            if (currentDepth === maxDepth) return info;
            
            const items = obj.slice(0, 3).map(item => 
                inspectObject(item, '', maxDepth, currentDepth + 1)
            );
            return `${info}${items.length ? ': [' + items.join(', ') + (obj.length > 3 ? ', ...' : '') + ']' : ''}`;
        }
        
        const keys = Object.keys(obj);
        const info = `对象{${keys.length}键}`;
        if (currentDepth === maxDepth) return info;
        
        const entries = keys.slice(0, 5).map(key => 
            `${key}: ${inspectObject(obj[key], '', maxDepth, currentDepth + 1)}`
        );
        return `${info}${entries.length ? ': {' + entries.join(', ') + (keys.length > 5 ? ', ...' : '') + '}' : ''}`;
    } catch (error) {
        return `[检查时出错: ${error.message}]`;
    }
}

// 加载插件设置
function loadSettings() {
    logDebug('加载设置');
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
        saveSettingsDebounced();
    }

    $('#prompt_exporter_enabled').prop('checked', extension_settings[extensionName].enabled);
    $('#prompt_exporter_auto').prop('checked', extension_settings[extensionName].autoExport);
    $('#prompt_exporter_debug').prop('checked', extension_settings[extensionName].debugMode);
    $('#prompt_exporter_pretty').prop('checked', extension_settings[extensionName].prettyPrint);
    $('#prompt_exporter_intercept').prop('checked', extension_settings[extensionName].interceptMode);
    
    logDebug('设置加载完成', extension_settings[extensionName]);
}

// 创建下载链接
function createDownloadLink(data, fileName) {
    try {
        logDebug('创建下载链接', fileName);
        const spacing = extension_settings[extensionName].prettyPrint ? 2 : 0;
        const jsonString = JSON.stringify(data, null, spacing);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // 创建下载链接
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = fileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        
        // 更新状态信息
        $('#prompt_exporter_status span').text(`上次导出: ${new Date().toLocaleString()}`);
        
        logInfo('文件下载链接已创建', fileName);
        toastr.success(`Prompt结构已导出: ${fileName}`, '导出成功');
        return true;
    } catch (error) {
        logError('创建下载链接失败', error);
        toastr.error(`导出失败: ${error.message}`, '错误');
        return false;
    }
}

// 导出Prompt结构
function exportPromptStruct() {
    try {
        if (!lastPromptStruct) {
            logWarning('没有可用的Prompt结构数据');
            toastr.warning('没有可用的Prompt结构数据，请先发送一条消息', '警告');
            return false;
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `prompt_struct_${exportCount}_${timestamp}.json`;
        exportCount++;
        
        return createDownloadLink(lastPromptStruct, fileName);
    } catch (error) {
        logError('导出Prompt结构失败', error);
        toastr.error(`导出失败: ${error.message}`, '错误');
        return false;
    }
}

// 建立拦截器
function setupPromptInterceptor() {
    if (!extension_settings[extensionName].interceptMode) {
        logDebug('拦截器模式已禁用');
        return;
    }
    
    logInfo('正在设置buildPromptStruct拦截器');
    
    try {
        // 导入buildPromptStruct函数
        import("../../../../decl/prompt_struct.mjs").then(module => {
            if (!module.buildPromptStruct) {
                logError('找不到buildPromptStruct函数');
                return;
            }
            
            // 保存原始函数
            const originalBuildPrompt = module.buildPromptStruct;
            
            // 替换为我们的拦截版本
            module.buildPromptStruct = async function(...args) {
                try {
                    // 调用原始函数
                    const result = await originalBuildPrompt.apply(this, args);
                    
                    // 如果插件被禁用，直接返回结果
                    if (!extension_settings[extensionName].enabled) {
                        return result;
                    }
                    
                    logDebug('拦截到buildPromptStruct调用，参数:', inspectObject(args[0]));
                    logDebug('返回完整prompt_struct:', inspectObject(result));
                    
                    // 将结果保存为最新的promptStruct
                    lastPromptStruct = JSON.parse(JSON.stringify(result));
                    
                    logInfo('通过拦截器成功捕获完整prompt结构');
                    
                    // 生成调试信息
                    if (extension_settings[extensionName].debugMode) {
                        if (result.user_prompt && result.user_prompt.text) {
                            logDebug(`user_prompt.text包含${result.user_prompt.text.length}条项目`);
                            for (let i = 0; i < Math.min(3, result.user_prompt.text.length); i++) {
                                const item = result.user_prompt.text[i];
                                logDebug(`user_prompt.text[${i}]:`, item ? inspectObject(item) : 'undefined');
                            }
                        }
                        
                        if (result.char_prompt && result.char_prompt.text) {
                            logDebug(`char_prompt.text包含${result.char_prompt.text.length}条项目`);
                            for (let i = 0; i < Math.min(3, result.char_prompt.text.length); i++) {
                                const item = result.char_prompt.text[i];
                                logDebug(`char_prompt.text[${i}]:`, item ? inspectObject(item) : 'undefined');
                            }
                        }
                    }
                    
                    // 如果启用了自动导出，则自动下载文件
                    if (extension_settings[extensionName].autoExport) {
                        logDebug('自动导出模式已启用，自动导出Prompt结构');
                        exportPromptStruct();
                    }
                    
                    return result;
                } catch (error) {
                    logError('拦截buildPromptStruct时出错:', error);
                    // 返回原始函数结果，确保正常功能不受影响
                    return originalBuildPrompt.apply(this, args);
                }
            };
            
            logInfo('buildPromptStruct拦截器设置成功');
        }).catch(error => {
            logError('导入buildPromptStruct函数时出错:', error);
        });
        
        // 尝试拦截structPromptToSingle函数获取完整数据
        import("../../../../decl/prompt_struct.mjs").then(module => {
            if (!module.structPromptToSingle) {
                logError('找不到structPromptToSingle函数');
                return;
            }
            
            // 保存原始函数
            const originalStructPromptToSingle = module.structPromptToSingle;
            
            // 替换为我们的拦截版本
            module.structPromptToSingle = function(prompt) {
                try {
                    // 如果插件被禁用，直接返回结果
                    if (!extension_settings[extensionName].enabled) {
                        return originalStructPromptToSingle.apply(this, [prompt]);
                    }
                    
                    logDebug('拦截到structPromptToSingle调用');
                    
                    // 深拷贝捕获的数据
                    if (prompt && typeof prompt === 'object') {
                        lastPromptStruct = JSON.parse(JSON.stringify(prompt));
                        logInfo('通过structPromptToSingle拦截器成功捕获完整prompt结构');
                        
                        // 如果启用了自动导出，则自动下载文件
                        if (extension_settings[extensionName].autoExport) {
                            logDebug('自动导出模式已启用，自动导出Prompt结构');
                            exportPromptStruct();
                        }
                    }
                    
                    // 调用原始函数
                    return originalStructPromptToSingle.apply(this, [prompt]);
                } catch (error) {
                    logError('拦截structPromptToSingle时出错:', error);
                    // 返回原始函数结果，确保正常功能不受影响
                    return originalStructPromptToSingle.apply(this, [prompt]);
                }
            };
            
            logInfo('structPromptToSingle拦截器设置成功');
        }).catch(error => {
            logError('导入structPromptToSingle函数时出错:', error);
        });
        
    } catch (error) {
        logError('设置拦截器时出错:', error);
    }
}

// 处理事件
function handlePromptReady(prompt_struct) {
    try {
        if (!extension_settings[extensionName].enabled) {
            logDebug('插件已禁用，不处理prompt');
            return;
        }
        
        logInfo('捕获到Prompt结构');
        logDebug('PromptStruct基本属性:', Object.keys(prompt_struct));
        
        // 检查是否为预期的prompt_struct格式
        if (!prompt_struct.char_prompt || !prompt_struct.user_prompt || !prompt_struct.world_prompt) {
            logWarning('Prompt结构缺少必要属性: char_prompt, user_prompt, world_prompt, chat_log');
            
            // 尝试查看prompt_struct详细信息以便调试
            for (const key in prompt_struct) {
                logDebug(`prompt_struct.${key} =`, inspectObject(prompt_struct[key]));
            }
            
            return;
        }
        
        // 深拷贝以防止修改原始数据
        lastPromptStruct = JSON.parse(JSON.stringify(prompt_struct));
        
        logInfo('已保存最新的Prompt结构数据');
        
        // 如果启用了自动导出，则自动下载文件
        if (extension_settings[extensionName].autoExport) {
            logDebug('自动导出模式已启用，自动导出Prompt结构');
            exportPromptStruct();
        }
    } catch (error) {
        logError('处理Prompt结构失败', error);
    }
}

// 注册插件UI
jQuery(async () => {
    try {
        logInfo('初始化Prompt结构导出器插件');
        
        // 创建插件UI
        const settingsHtml = `
        <div class="prompt-exporter-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Prompt结构导出器</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_enabled">
                            <input id="prompt_exporter_enabled" type="checkbox" />
                            <span>启用插件</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_auto">
                            <input id="prompt_exporter_auto" type="checkbox" />
                            <span>自动导出(每次消息自动下载)</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_debug">
                            <input id="prompt_exporter_debug" type="checkbox" />
                            <span>调试模式</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_pretty">
                            <input id="prompt_exporter_pretty" type="checkbox" />
                            <span>格式化JSON</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_intercept">
                            <input id="prompt_exporter_intercept" type="checkbox" />
                            <span>使用拦截模式 (推荐)</span>
                        </label>
                        <div class="fa-solid fa-circle-info" title="拦截模式可以更准确地捕获完整prompt结构。禁用后需要重启SillyTavern。"></div>
                    </div>
                    <div class="flex-container mt-2">
                        <input id="prompt_exporter_button" class="menu_button" type="button" value="导出最新Prompt结构" />
                    </div>
                    <div class="flex-container" id="prompt_exporter_status">
                        <span>上次导出: 未导出</span>
                    </div>
                    <hr class="sysHR" />
                </div>
            </div>
        </div>`;
        
        // 添加插件UI到设置面板
        $("#extensions_settings").append(settingsHtml);
        
        // 绑定事件处理函数
        $('#prompt_exporter_enabled').on('change', function() {
            extension_settings[extensionName].enabled = !!$(this).prop('checked');
            logInfo(`插件已${extension_settings[extensionName].enabled ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_auto').on('change', function() {
            extension_settings[extensionName].autoExport = !!$(this).prop('checked');
            logInfo(`自动导出模式已${extension_settings[extensionName].autoExport ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_debug').on('change', function() {
            extension_settings[extensionName].debugMode = !!$(this).prop('checked');
            logInfo(`调试模式已${extension_settings[extensionName].debugMode ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_pretty').on('change', function() {
            extension_settings[extensionName].prettyPrint = !!$(this).prop('checked');
            logInfo(`格式化JSON已${extension_settings[extensionName].prettyPrint ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_intercept').on('change', function() {
            extension_settings[extensionName].interceptMode = !!$(this).prop('checked');
            logInfo(`拦截模式已${extension_settings[extensionName].interceptMode ? '启用' : '禁用'}`);
            
            if (extension_settings[extensionName].interceptMode) {
                setupPromptInterceptor();
            } else {
                toastr.warning('更改拦截模式设置需要重启SillyTavern才能生效', '需要重启');
            }
            
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_button').on('click', function() {
            logDebug('点击导出按钮');
            exportPromptStruct();
        });
        
        // 监听SillyTavern事件
        logDebug('注册事件监听器');
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptReady);
        
        // 设置拦截器(这是获取完整结构的最可靠方法)
        setupPromptInterceptor();
        
        // 加载设置
        loadSettings();
        
        logInfo('插件初始化完成');
    } catch (error) {
        logError('插件初始化失败', error);
    }
});
