const { createLogger, format, transports } = require('winston');
const { MyDate } = require('./my_util');

class MyLog {
    static logger = null;
    /**
     * 
     * @param {string} log_file_path 不包含后缀名的日志文件路径 
     */
    static Init(log_file, test_env = undefined) {
        // 自动检测是否处于调试/开发模式：
        // - NODE_ENV !== 'production'
        // - 启动参数包含 --inspect/--debug
        // - Electron 未打包 (app.isPackaged === false)
        // - 环境变量 ELECTRON_IS_DEV / VSCODE_DEBUGGING
        if (typeof test_env === 'undefined') {
            let isDev = false;
            try {
                const nodeEnvDev = !!(process.env.NODE_ENV && process.env.NODE_ENV !== 'production');
                const execArgv = process.execArgv || [];
                const hasInspect = execArgv.some(a => /--inspect|--debug/.test(a));
                const isElectronDevEnv = process.env.ELECTRON_IS_DEV === '1' || process.env.ELECTRON_IS_DEV === 'true';
                const isVsCodeDebug = !!process.env.VSCODE_DEBUGGING;
                isDev = nodeEnvDev || hasInspect || isElectronDevEnv || isVsCodeDebug;
            } catch (e) {
                isDev = false;
            }
            test_env = isDev;
        }

        if (test_env) {
            console.log(MyDate.Now() + " Logger initialized in TEST/DEV mode.");
        }else{
            console.log(MyDate.Now() + " Logger initialized in PRODUCTION mode.");
        }

        const trs = [
            // error 及以上日志写入文件
            new transports.File({ filename: log_file + '.error.log', level: 'error' }),
            // 所有日志写入文件
            new transports.File({ filename: log_file + '.log', level: test_env ? 'debug' : 'info' }),
        ];

        // 同时输出到 Console
        trs.push(new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(info => `${[info.timestamp]}: ${info.level} : ${info.message}`)
            ),
            level: test_env ? 'debug' : 'info'
        }));

        this.logger = createLogger({
            level: 'info',
            format: format.combine(
                format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                //format.align(),
                format.printf(info => `${[info.timestamp]}: ${info.level} : ${info.message}`),
            ),
            defaultMeta: { service: 'user-service' },
            transports: trs,
        });
    }

    static FromatLog(info, level = 'info') {
        return MyDate.Now() + " " + level + ': ' + info;
    }

    static Info(info, is_need_mask = false) {
        if (is_need_mask) {
            info = this.MaskSensitiveInfo(info);
        }
        if (this.logger) {
            this.logger.info(info);
        } else {
            console.log(this.FromatLog(info));
        }
    }

    static Warn(info) {
        if (this.logger) {
            this.logger.warn(info);
        } else {
            console.warn(this.FromatLog(info, 'warn'));
        }
    }

    static Error(info) {
        if (this.logger) {
            this.logger.error(info);
        } else {
            console.error(this.FromatLog(info, 'error'));
        }
    }

    static Debug(info, is_need_mask = false) {
        if (is_need_mask) {
            info = this.MaskSensitiveInfo(info);
        }
        if (this.logger) {
            this.logger.debug(info);
        } else {
            console.debug(this.FromatLog(info, 'debug'));
        }
    }

    // 提供一个脱敏函数，对类似 --password xxx 的敏感信息脱敏处理
    static MaskSensitiveInfo(cmd_str) {
        return cmd_str.replace(/(--password\s+)([^\s]+)/gi, '$1****');
    }
}

module.exports = MyLog;