var MyDevTool = class {
    // 打印信息到终端，格式为 日期 DEBUG: 信息, 如果传入对象，需要将其转换为json字符串
    static Debug(val, ...args){
        const now = new Date();
        const timestamp = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().replace('T', ' ').substring(0, 19);
        
        // 处理主要值
        let message = '';
        if (typeof val === 'object') {
            try {
                message = JSON.stringify(val, null, 2);
            } catch (e) {
                message = String(val);
            }
        } else {
            message = String(val);
        }
        
        // 处理额外参数
        let additionalArgs = '';
        if (args && args.length > 0) {
            additionalArgs = args.map(arg => {
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch (e) {
                        return String(arg);
                    }
                } else {
                    return String(arg);
                }
            }).join(' ');
        }
        
        const fullMessage = additionalArgs ? `${message} ${additionalArgs}` : message;
        console.log(`\n${timestamp} DEBUG: ${fullMessage}\n`);
    }

}

if(typeof module != "undefined" && typeof module.exports != "undefined"){
    module.exports = {MyDevTool,};
}