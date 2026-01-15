const { exec } = require('child_process');
const { shell } = require('electron');
const path = require('path')

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
        if(process.platform == 'win32'){
            exec('start "" "' + dir_path + '"');
        }else if(process.platform == 'darwin'){
            exec('open "' + dir_path + '"');
        }else{
            // For Linux and other platforms
            exec('xdg-open "' + dir_path + '"');
        }
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
        // 直接调用code命令打开文件,注意不同平台差异
        if(!ide_cmd){
            if(process.platform == 'win32'){
                ide_cmd = 'code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"'; // Windows默认使用VS Code
            }else if(process.platform == 'darwin'){
                ide_cmd = 'code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"'; // macOS默认使用VS Code
            }else{
                ide_cmd = 'code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"'; // For Linux and other platforms，默认使用VS Code
            }
        }
        
        if(dir_path){
            // 将命令中的 %%DIR_PATH%% 替换为实际的目录路径，并确保路径被正确引用
            ide_cmd = ide_cmd.replace('%%DIR_PATH%%', dir_path);
        }
        // 将命令中的 %%FILE_PATH%% 替换为实际的文件路径，并确保路径被正确引用
        ide_cmd = ide_cmd.replace('%%FILE_PATH%%', file_path);
        // 执行命令
        exec(ide_cmd, { encoding: 'utf-8'}, (error) => {
            if (error) {
                // 将错误信息转换为字符串，避免中文乱码问题
                const errorMsg = error.toString();
                throw new Error(`open file with ide cmd [ ${ide_cmd} ] fail: ${errorMsg}`);
            }
        });
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