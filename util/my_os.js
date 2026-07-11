const { spawn, execFile } = require('child_process');
const { shell } = require('electron');
const path = require('path');
const MyLog = require('./my_log');

/**
 * 解析命令行字符串为 [程序名, 参数...]，按空格分割，单/双引号内的空格保留
 * @param {string} cmd - 命令行字符串
 * @returns {string[]}
 */
function parseCmdArgs(cmd) {
    const parts = [];
    let current = '';
    let quoteChar = '';
    for (const ch of cmd) {
        if (ch === '"' || ch === "'") {
            if (quoteChar) {
                if (ch === quoteChar) { quoteChar = ''; }
                else { current += ch; }
            } else {
                quoteChar = ch;
            }
        } else if (ch === ' ' && !quoteChar) {
            if (current) { parts.push(current); current = ''; }
        } else {
            current += ch;
        }
    }
    if (current) parts.push(current);
    return parts;
}

class MyOs{

    /**
     * 获取当前操作系统类型
     * @returns mac/windows/linux
     */
    static GetOsType(){
        if(process.platform === 'darwin'){
            return 'mac'
        }else if(process.platform === 'win32'){
            return 'windows'
        }else{
            // process.platform在Linux: 返回 "linux"  FreeBSD: 返回 "freebsd"
            return 'linux'
        }
    }

    /**
     * 使用系统默认文件管理器打开目录
     * @param {*} dir_path 
     */
    static OpenDir(dir_path){
        shell.openPath(dir_path);
    }

    /**
     * 如果文件是txt，md等文本文件，直接使用默认应用打开；否则打开目录，并选中文件，避免直接执行危险脚本或程序
     * @param {*} file_path 
     */
    static OpenFile(file_path){
        let ext = path.extname(file_path);
        // 对于常见的非执行程序的文本文件直接打开
        var txt_exts = ['.txt', '.md', '.h', '.c', '.cpp', '.java', '.go', '.css', '.php', '.sql', '.json', '.xml', '.yml', '.yaml', '.ini', '.conf', '.cfg', '.log', 'jpg', '.png', '.gif', '.svg', '.bmp', '.webp', '.txt', '.js', '.ts', '.html', '.htm', '.vue'];
        if(txt_exts.includes(ext)){
            MyOs.OpenFileWithDefaultApp(file_path, MyOs.GetOsType());
        }else{
            MyOs.OpenDirAndSelectFile(file_path);
        }

    }

    static OpenFileWithIde(file_path, dir_path='', ide_cmd=''){
        if(!ide_cmd){
            if(process.platform == 'win32'){
                ide_cmd = 'code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"';
            }else if(process.platform == 'darwin'){
                ide_cmd = 'code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"';
            }else{
                ide_cmd = 'code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"';
            }
        }
        
        // 解析命令模板，去掉引号后按空格分割
        const cmdParts = parseCmdArgs(ide_cmd);
        const program = cmdParts[0];
        const args = cmdParts.slice(1).map(arg => {
            arg = arg.replace('%%FILE_PATH%%', file_path);
            if(dir_path){
                arg = arg.replace('%%DIR_PATH%%', dir_path);
            }
            return arg;
        });
        
        if (process.platform === 'win32') {
            // Windows: 通过 cmd.exe /c 启动（不加 /s），libuv 自动为含空格参数加上引号，
            // cmd.exe 按标准解析规则处理，不会剥离引号
            const child = spawn('cmd.exe', ['/c', program, ...args], { shell: false, windowsHide: true });
            child.on('error', (error) => {
                MyLog.Error(`open file with ide cmd fail: ${error.toString()}`);
            });
        } else {
            // macOS / Linux: execFile 不经过 shell，参数以数组形式传递，规避空格分词
            const child = execFile(program, args, (error) => {
                if (error) {
                    MyLog.Error(`open file with ide cmd fail: ${error.toString()}`);
                }
            });
            child.on('close', (code) => {
                MyLog.Info('[OpenFileWithIde] process exited with code: ' + code);
            });
        }
    }

    /**
     * 打开文件所在目录并选择文件
     */
    static OpenDirAndSelectFile(file_path){
        shell.showItemInFolder(`${file_path}`);
    }

    /**
     * 使用默认程序打开文件
     * @param {*} file_path 
     * @param {*} os_type 
     */
    static OpenFileWithDefaultApp(file_path, os_type){
        shell.openPath(file_path);
    }
}

module.exports = MyOs;