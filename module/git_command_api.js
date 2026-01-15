const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const MyLog = require('../util/my_log');
const crypto = require('crypto');
const MyFile = require('../util/my_file');
const { MyDate, MyUnit } = require('../util/my_util');
const {MyDevTool} = require('../util/my_devtool');
const { url } = require('inspector');

class GitCommandApi {
    constructor(repo_url, user, password, os_type, cache_dir) {
        this.repo_url = repo_url;
        this.user = user;
        this.password = password;
        this.os_type = os_type;
        this.cache_dir = cache_dir;
        this.submodule_path_dict = null;

        // repo_url必须以.git结尾
        if (!repo_url.endsWith('.git')) {
            throw new Error('repo_url must end with .git');
        }

        // 如果是linux系统，环境变量中必须设置TZ
        if(this.os_type === 'linux'){
            if(!process.env.TZ){
                throw new Error('linux system must set TZ environment variable');
            }
        }

        this.repo_name = path.basename(repo_url, '.git');
        const hash = crypto.createHash('md5').update(repo_url).digest('hex');
        this.repo_path = path.join(this.cache_dir, hash);
        MyLog.Info(`git command api init, repo: ${repo_url}, os type:${this.os_type}, cache dir: ${this.cache_dir}, repo path: ${this.repo_path}`);

        this._cache_status = {
            br_name: '',
            up_time: '',
        }
    }

    /**
     * 获取repo根目录，即trunk、branches、tags的上一级目录
     * @param {*} repo_url 
     */
    GetRepoRoot(repo_url){
        if(!repo_url){
            repo_url = this.repo_url;
        }
        if(repo_url.endsWith('.git')){
            return repo_url;
        }else{
            // 找到第一个xxx.git结尾的目录位置，返回上级目录
            const index = repo_url.lastIndexOf('.git/');
            if(index === -1){
                return repo_url;
            }else{
                // 找到index之前的最后一个/的位置，返回该位置之后的字符串
                const lastIndex = repo_url.lastIndexOf('/', index);
                if(lastIndex === -1){
                    return repo_url;
                }else{
                    return repo_url.substring(0, lastIndex);
                }
            }
        }
    }

    /**
     * 获取url对应的本地路径
     * @param {*} repo_url 
     */
    GetLocalPath(repo_url){
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(repo_url);
        return path.join(this.repo_path, filePath);
    }

    GetLocalRepoPath() {
        return this.repo_path;
    }

    GetCacheStatus(){
        return this._cache_status;
    }

    /**
     * 执行git命令
     * @param {*} cmd_params 对于windows环境，注意命令中不要出现换行符，^都应该被双引号包裹
     * @param {*} cwd 
     * @param {*} log_error 
     * @param {*} use_git_bash 
     * @returns 
     */
    async _GetGitCommandResult(cmd_params, cwd = this.repo_path, log_error = true, use_git_bash = false) {
        return new Promise((resolve, reject) => {
            let cmd_str;
            if (this.os_type === 'windows'){
                if(use_git_bash){
                    const git_exe = 'git';
                    const gitBashPath = this._GetGitBashPath();
                    cmd_str = `"${gitBashPath}" -c ${JSON.stringify(git_exe + ' ' + cmd_params)}`;
                }else{
                    const git_exe = 'git.exe';
                    cmd_str = `${git_exe} ${cmd_params}`;
                }
            }else{
                const git_exe = 'git';
                cmd_str = `${git_exe} ${cmd_params}`;
            }
            MyLog.Info(`command: ${cmd_str}`);
            exec(cmd_str, { cwd, maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
                if (error) {
                    error.message += `\nCommand: ${cmd_str}`;
                    reject(GitCommandApi._ProcessCommandError(error, log_error));
                } else {
                    resolve(stdout.toString());
                }
            });
        });
    }

    static _ProcessCommandError(error, log_error = true) {
        var msg = `${error.message}`;
        msg = msg.replace(/--password\s+\S+/, '--password ******');
        msg = msg.replace(/([^.;\n\r,。；])\s*\n/g, '$1; \n');
        if (log_error) {
            MyLog.Error(msg);
        }
        return msg;
    }

    async RefreshRepoTree(repo_url){
        const lastUpdateFile = path.join(this.repo_path, '--repo-viewer-last-update.info');
        const lastBrFile = path.join(this.repo_path, `--repo-viewer-last-branch.info`);
        if(fs.existsSync(lastUpdateFile)){
            fs.unlinkSync(lastUpdateFile);
        }
        if(fs.existsSync(lastBrFile)){
            fs.unlinkSync(lastBrFile);
        }
    }

    /**
     * 从远程仓库拉取代码, 如果本地已经存在，则更新代码, 并切换到指定分支, 并切换到指定文件路径, 如果文件路径为空，则切换到仓库根目录, 如果文件路径为'./xxx/xx'则切换到仓库根目录下的xxx目录。
     * 同一个分支，只有距离上次更新时间大于指定分钟时才进行更新
     * @param {*} branch    分支信息
     * @param {*} filePath  文件路径
     */
    async _CloneOrUpdateRepo(branch_type, branch, filePath) {
        if(branch == ''){
            branch = 'master';
        }
        MyFile.MkDir(this.cache_dir);
        const lastUpdateFile = path.join(this.repo_path, '--repo-viewer-last-update.info');
        let shouldFetch = true;
        let shouldCheckout = true;

        const lastBrFile = path.join(this.repo_path, `--repo-viewer-last-branch.info`);

        if (fs.existsSync(lastUpdateFile)) {
            const lastUpdateContent = fs.readFileSync(lastUpdateFile, 'utf-8');
            const lastUpdateTime = new Date(lastUpdateContent);
            const now = new Date();
            const diffMinutes = (now - lastUpdateTime) / (1000 * 60);
            // 如果距离上次更新时间小于120分钟，则不更新
            if (diffMinutes <= 120) {
                shouldFetch = false;
                if (!this._cache_status.up_time){
                    this._cache_status.up_time = lastUpdateContent;
                }
            }
        }

        if (fs.existsSync(lastBrFile)) {
            const lastBrContent = fs.readFileSync(lastBrFile, 'utf-8');
            if (lastBrContent === branch && !shouldFetch) {
                shouldCheckout = false;
                if (!this._cache_status.br_name){
                    this._cache_status.br_name = lastBrContent;
                }
            }
        }

        if (!fs.existsSync(this.repo_path)) {
            await this._GetGitCommandResult(`clone ${this.repo_url} ${this.repo_path}`, this.cache_dir);

            // 进入到仓库根目录
            process.chdir(this.repo_path);

            var up_time = new Date().toISOString(); // ISO 8601格式，带有时区（以Z结尾，表示UTC时间）
            fs.writeFileSync(lastUpdateFile, up_time);
            this._cache_status.up_time = new Date().toISOString();
            fs.writeFileSync(lastBrFile, branch);
            this._cache_status.br_name = branch;

            // 生成 目录名.info 文件, 记录git仓库地址
            fs.writeFileSync(this.repo_path + '.info', this.repo_url);

            this.submodule_path_dict = await this._GetSubmodulePath();
        } else {
            // 进入到仓库根目录
            process.chdir(this.repo_path);

            if (shouldFetch) {
                if (branch_type == 'tags') {
                    await this._GetGitCommandResult(`fetch origin -q --prune --tags`);
                } else {
                    await this._GetGitCommandResult(`fetch origin -q --prune`);
                }
                var up_time = new Date().toISOString();
                fs.writeFileSync(lastUpdateFile, up_time);
                this._cache_status.up_time = up_time;
            }
            if (shouldCheckout) {
                if (branch_type == 'tags') {
                    await this._GetGitCommandResult(`checkout ${branch}`);
                } else {
                    await this._GetGitCommandResult(`checkout ${branch}`);
                    await this._GetGitCommandResult(`pull --rebase`);
                }
                fs.writeFileSync(lastBrFile, branch);
                this._cache_status.br_name = branch;
                this.submodule_path_dict = await this._GetSubmodulePath();
            }
        }

        if (this.submodule_path_dict === null) {
            MyLog.Info('init submodule_path_dict');
            this.submodule_path_dict = await this._GetSubmodulePath();
        }
    }

    /**
     * 解析url中的分支信息及分支之后的文件路径
     * @param {*} url 
     * @returns 返回一个元祖，第一个元素是分支类型、第二个元素是分支信息，第三个元素是文件路径
     */
    _ExtractBranchFromUrl(url) {
        url = url.replace(/\/$/, ''); // 去除末尾的/
        // url中包含分支、文件路径的完整信息
        var branchMatch = url.match(/\/(master|branches\/[^\/]+|tags\/[^\/]+)\/(.*)/);
        if (branchMatch) {
            const branchType = branchMatch[1].startsWith('branches/') ? 'branches' : branchMatch[1].startsWith('tags/') ? 'tags' : 'master';
            // 如果为分支或tag，需要去除branches/或tags/前缀
            const branchName = branchType === 'master' ? 'master' : branchMatch[1].replace(/branches\//, '').replace(/tags\//, '');
            return [branchType, branchName, branchMatch[2]];
        }
        // url中包含分支名
        var branchMatch = url.match(/\/(master|branches\/[^\/]+|tags\/[^\/]+)/);
        if (branchMatch) {
            const branchType = branchMatch[1].startsWith('branches/') ? 'branches' : branchMatch[1].startsWith('tags/') ? 'tags' : 'master';
            // 如果为分支或tag，需要去除branches/或tags/前缀
            const branchName = branchType === 'master' ? 'master' : branchMatch[1].replace(/branches\//, '').replace(/tags\//, '');
            return [branchType, branchName, ''];
        }else {
            // url中不包含分支名
            const parts = url.split('/');
            const branchType = parts[parts.length - 1] === 'branches' ? 'branches' : parts[parts.length - 1] === 'tags' ? 'tags' : 'master';
            const branchName = branchType === 'master' ? 'master' : '';
            return [branchType, branchName, ''];
        }
    }

    /**
     * 获取所有分支名
     * @returns 返回所有分支名，不包含origin/HEAD、origin/master
     */
    async _GetBranches() {
        let res = await this._GetGitCommandResult(`branch -r`);
        // 返回的分支名需要去除 origin/HEAD、origin/master 对应行，然后去除前缀 origin/
        res = res.replace(/origin\/HEAD\s+.*\n/, '');
        res = res.replace(/origin\/master\n/, '');
        return res.split('\n').filter(branch => branch.trim()).map(branch => branch.trim().replace('origin/', ''));
    }

    async _GetTags() {
        try {
            // 获取远端tag列表（只获取远端存在的tag）
            let res = await this._GetGitCommandResult(`ls-remote --tags origin`);
            
            // 解析远端tag，排除^{}引用，只保留实际tag
            let tags = [];
            let lines = res.split('\n').filter(line => line.trim());
            
            for (let line of lines) {
                if (line.includes('refs/tags/') && !line.endsWith('^{}')) {
                    let parts = line.split('\t');
                    if (parts.length >= 2) {
                        let tagPath = parts[1].replace('refs/tags/', '');
                        if (tagPath.trim()) {
                            tags.push(tagPath);
                        }
                    }
                }
            }
            
            // 获取每个tag的最后提交时间，并按时间降序排序
            const tagsWithDate = await Promise.all(tags.map(async tag => {
                try {
                    // 获取tag指向的最后一次提交的日期
                    const dateRes = await this._GetGitCommandResult(`log -1 --pretty=format:"%ad" --date=iso ${tag}`);
                    return { tag, date: new Date(dateRes.trim()) };
                } catch (error) {
                    // 如果无法获取提交时间，使用当前时间作为fallback
                    return { tag, date: new Date() };
                }
            }));
            
            // 按时间降序排序，取最新的50个
            return tagsWithDate
                .sort((a, b) => b.date - a.date)
                .slice(0, 50)
                .map(item => item.tag);
        } catch (error) {
            MyLog.Error(`Failed to get tags: ${error.message}`);
            return [];
        }
    }

    async _GetTree(branch, filePath) {
        if(filePath == ''){
            var res = await this._GetGitCommandResult(`ls-tree --abbrev=7 ${branch}`);
        }else{
            var res = await this._GetGitCommandResult(`ls-tree --abbrev=7 ${branch} ${filePath}/`);
        }
        let lines = res.split('\n').filter(line => line);
        let tree = { dirs: [], files: [] };

        lines.forEach(line => {
            let [mode, type, hash, curFilePath] = line.split(/\s+/);
            // 去除filePath中的前缀filePath,注意需要从第一个字符开始匹配
            curFilePath = curFilePath.replace(new RegExp('^' + filePath + '/'), '');
            if (type === 'tree') {
                let cur_node = { text: curFilePath, date: '', children: ["."] };
                tree.dirs.push(cur_node);
            } else {
                let cur_node = { text: curFilePath, revision: hash, author: '', date: '', size: '' };
                tree.files.push(cur_node);
            }
        });

        // 获取文件的作者、日期、大小
        for (let file of tree.files) {
            // 拼接完整路径
            var full_path = path.join(filePath, file.text);
            // 如果为submodule，需要跳过
            if(this.submodule_path_dict[full_path]){
                file.author = 'submodule';
                file.date = '0000-00-00 00:00:00';
                file.size = MyUnit.FileSizeStr(0);
                file.size_num = 0;
                continue;
            }
            try {
                let logPromise = this._GetGitCommandResult(`log -1 --pretty=format:"%an|%ad" --date=iso -- ${full_path}`);
                let sizePromise = this._GetGitCommandResult(`cat-file -s ${file.revision}`);

                let [logRes, sizeRes] = await Promise.all([logPromise, sizePromise]);

                let [author, date] = logRes.split('|');
                file.author = author;
                file.date = MyDate.GetDateStr(new Date(date), true);
                file.size = MyUnit.FileSizeStr(sizeRes);
                file.size_num = parseInt(sizeRes);
            } catch (error) {
                // 捕获异常，设置默认值
                file.author = 'unknown';
                file.date = '0000-00-00 00:00:00';
                file.size = MyUnit.FileSizeStr(0);
                file.size_num = 0;
                MyLog.Error(`Failed to get file info for ${full_path}: ${error.message}`);
            }
        }
        return tree;
    }

    /**
     * 解析repo_url，获取服务器根目录、库路径、库路径后的文件路径
     * @param {*} repo_url 仓库url，例如 git@github.com:wxbool/video-srt-windows.git、https://github.com/wxbool/video-srt-windows.git、ssh://github.com:8080/wxbool/video-srt-windows.git
     * @returns json对象 {server_root, repo_root, repo_path, path_without_repo}
     * server_root: 服务器根目录, 例如 ssh://github.com:8080
     * repo_root: 包含服务器地址的仓库地址，例如 ssh://github.com:8080/wxbool/video-srt-windows.git
     * repo_path: 去掉服务路径后的库路径，例如wxbool/video-srt-windows.git
     * path_without_repo: 去掉库路径的文件路径，以/开头，例如/master/a.txt
     */
    _ParseServerRoot(repo_url) {
        let server_root = '' , path_without_server = '', repo_path = '', path_without_repo = '', server_split = '/';

        if (repo_url.startsWith('http')) {
            // HTTP URLs: https://github.com/wxbool/video-srt-windows.git
            const urlObj = new URL(repo_url);
            server_root = urlObj.origin;
            path_without_server = urlObj.pathname.substring(1); // 去掉开头的'/'
        } else if (repo_url.startsWith('ssh://')) {
            // SSH URLs with protocol: ssh://github.com:8080/wxbool/video-srt-windows.git
            const sshMatch = repo_url.match(/(ssh:\/\/[^\/]+)\/(.+)/);
            if (sshMatch) {
                server_root = sshMatch[1];
                path_without_server = sshMatch[2];
            }else{
                throw new Error('Invalid ssh git url');
            }
        } else {
            // SCP-like syntax: git@github.com:wxbool/video-srt-windows.git
            const parts = repo_url.split(':');
            server_root = parts[0];
            path_without_server = parts[1];
            server_split = ':';
        }
        // 去掉服务路径后的库路径
        repo_path = path_without_server.split('.git', 1)[0] + '.git';
        // 去掉库路径的文件路径，以/开头
        path_without_repo = path_without_server.replace(repo_path, '');
        // 包含服务器地址的仓库地址
        let repo_root = `${server_root}${server_split}${repo_path}`;

        return { server_root, repo_root, repo_path, path_without_repo };
    }

    /**
     * 获取基础数据结构，包括路径对应一级目录结构、仓库根目录、服务器根目录等
     * @param {*} repo_url 仓库url，例如 git@github.com:wxbool/video-srt-windows.git、https://github.com/wxbool/video-srt-windows.git
     * @returns json对象，结构如下：
     * {
     *  "url":"git@github.com:wxbool/video-srt-windows.git/master/a.txt",
     *  "base":"wxbool/video-srt-windows.git", # 库名相对于服务器根目录的路径，库名根据第一个.git的内容生成
     *  "path":"/master/a.txt",  # 库的根到文件的路径
     *  "dirs":[ {"text":".vscode","date":"2024-06-23 11:06:26","children":["."]},...],
     *  "files":[ {"text":"LICENSE","revision":"6","author":"xxx","date":"2024-06-23 11:06:26","size":"1.05KB"},...], ...},
     *  "server_root":"git@github.com", # 服务器根目录
     *  "repo_root":"git@github.com:wxbool/video-srt-windows.git"
     * }
     */
    async GetRepoTree(repo_url = null) {
        if (!repo_url) {
            repo_url = this.repo_url;
        }
        // 提取server_root和base，server_root为服务器根目录，base为库名（相对于服务器根目录的路径）
        var { server_root, repo_root, repo_path, path_without_repo } = this._ParseServerRoot(repo_url);
        
        let base = repo_path;

        // 如果repo_url仅包含仓库地址（以.git结尾），返回初始目录结构
        if (repo_url.endsWith('.git')) {
            return {
                url: repo_url,
                base: base,
                path: '/',
                dirs: [
                    { text: 'branches', date: '', children: ['.'] },
                    { text: 'tags', date: '', children: ['.'] },
                    { text: 'master', date: '', children: ['.'] },
                ],
                files: [],
                server_root: server_root,
                repo_root: repo_root,
                local_cached: true,
            };
        }

        // 解析url中的分支信息及分支后的文件路径
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(repo_url);
        MyLog.Info(`url: ${repo_url}, branchType: ${branchType}, branch: ${branch}, filePath: ${filePath}`);
        await this._CloneOrUpdateRepo(branchType, branch, filePath);

        // 如果url中指定的是branches但未指定具体分支，则返回所有分支目录
        if (branchType === 'branches' && branch === '') {
            const branches = await this._GetBranches();
            // Get date information for each branch
            const branchesWithDates = await Promise.all(branches.map(async branch => {
                try {
                    const dateInfo = await this._GetGitCommandResult(`log -1 --pretty=format:"%ad" --date=iso origin/${branch}`);
                    const formattedDate = MyDate.GetDateStr(new Date(dateInfo), true);
                    return { branch, date: formattedDate };
                } catch (error) {
                    return { branch, date: '' };
                }
            }));
            
            return {
                url: repo_url,
                base: base,
                path: '/branches',
                dirs: branchesWithDates.map(b => ({ text: b.branch, date: b.date, children: ['.'] })),
                files: [],
                server_root: server_root,
                repo_root: repo_root
            };
        }

        // 如果url中指定的是tags但未指定具体tag，则返回所有tag目录
        if (branchType === 'tags' && branch === '') {
            const tags = await this._GetTags();
            return {
                url: repo_url,
                base: base,
                path: '/tags',
                dirs: tags.map(t => ({ text: t, date: '', children: ['.'] })),
                files: [],
                server_root: server_root,
                repo_root: repo_root
            };
        }

        // 获取具体分支、文件路径的目录树
        const tree = await this._GetTree(branch, filePath);
        tree.url = repo_url;
        tree.base = base;
        tree.path = path_without_repo;
        tree.server_root = server_root;
        tree.repo_root = repo_root;
        return tree;
    }

    /**
     * 获取文件指定版本的内容
     * @param {*} file_url 包含仓库路径、分支名、文件路径的url，例如 xxx/branches/master/xxx/xx/xx.txt
     * @param {*} version 
     * @returns 
     */
    async GetRepoFileContent(file_url, version = 'HEAD') {
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(file_url);
        await this._CloneOrUpdateRepo(branchType, branch, filePath);
        MyLog.Info('get content of: ' + file_url + ' with version: ' + version);
        let res = await this._GetGitCommandResult(`show ${version}:${filePath}`);
        return res;
    }

    // 导出文件到指定位置，dest_path为目标文件位置
    async ExportRepoFile(file_url, dest_path, version=null){
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(file_url);
        await this._CloneOrUpdateRepo(branchType, branch, filePath);
        MyLog.Info('export file: ' + file_url + ' to: ' + dest_path);
        // Ensure the destination directory exists
        MyFile.MkDir(path.dirname(dest_path));
        
        // Binary safe file export using cat-file
        const version_ref = version ? version : 'HEAD';
        if (version_ref === 'HEAD') {
            // If HEAD, we can use the file directly
            await this._GetGitCommandResult(`cat-file blob ${version_ref}:${filePath} > "${dest_path}"`);
            return dest_path;
        }else{
            // First, get the object hash
            const object_hash = await this._GetGitCommandResult(`rev-parse ${version_ref}:${filePath}`);
            // Then use git cat-file to write to a temporary location
            await this._GetGitCommandResult(`cat-file blob ${object_hash.trim()} > "${dest_path}"`);
            return dest_path;
        }
    }

    /**
     * 生成相对于仓库根目录的绝对路径
     * @param {*} branch_type 
     * @param {*} branch_name 
     * @param {*} parentDir 
     * @param {*} filePath 
     * @returns 
     */
    _GenAbsPath(branch_type, branch_name, parentDir, filePath) {
        let absPath = '';
        if (parentDir && parentDir !== '.') {
            absPath = `${parentDir}/${filePath}`;
        } else {
            absPath = filePath;
        }
        if (branch_type === 'master') {
            return `/${branch_name}/${absPath}`;
        } else {
            return `/${branch_type}/${branch_name}/${absPath}`;
        }
    }

    /**
     * 获取指定路径的提交日志导出
     * @param {*} repo_url 
     * @param {*} start_rev 
     * @param {*} end_rev 
     * @returns 返回的日志格式为 [{revision, author, date, msg, files: [{action, path, kind, text_mods, prop_mods, copy_from}]}]
     * action: A-添加，M-修改，D-删除
     * path: 文件路径，需要带上branchtype和branch信息，以/开头
     * kind: file-文件，dir-目录
     * text_mods: 是否是文本修改
     * prop_mods: 是否是属性修改
     * copy_from: 复制自哪个版本路径
     */
    async GetRepoLog(repo_url, start_rev = null, end_rev = null) {
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(repo_url);
        await this._CloneOrUpdateRepo(branchType, branch, filePath);
        MyLog.Info('get log of: ' + repo_url);
        let range = "";
        let only_self = '';
        if(start_rev && end_rev){
            range = `origin/${start_rev}..origin/${end_rev}`;
        }else{
            // 如果为分支，则增加与master的比较参数
            if(branchType == 'branches'){
                var parent_branch = 'master';
                // 如果分支名包含_rf_, 则 parent_branch为分支名去掉_rf_后的部分, 需要确认分支parent_branch是否存在
                if(branch.includes('_rf_')){
                    parent_branch = branch.split('_rf_')[0];
                    // 如果parent_branch不存在，则设置为master
                    const branches = await this._GetBranches();
                    if(!branches.includes(parent_branch)){
                        parent_branch = 'master';
                    }
                }
                range = `origin/${parent_branch}..origin/${branch}`;
            }
            only_self = '--first-parent';
        }
        // 需要考虑文件路径为空的情况
        if(filePath == ''){
            var res = await this._GetGitCommandResult(`log ${range} ${only_self} -100 --pretty=format:"%H|%an|%ad|%s" --date=iso origin/${branch}`);
        }else{
            var res = await this._GetGitCommandResult(`log ${range} ${only_self} -100 --pretty=format:"%H|%an|%ad|%s" --date=iso origin/${branch} -- ${filePath}`);
        }
        let logs = await Promise.all(res.split('\n').map(async line => {
            // 如果line为空，则直接返回
            if(!line){
                return;
            }
            let [revision, author, date, msg] = line.split('|');
            let date_str = MyDate.GetDateStr(new Date(date), true);
            // 将每次提交涉及的文件列表加入到日志中，文件对象格式如 {action, path, kind, text_mods, prop_mods, copy_from}
            let files = [];
            // 放弃的命令：show --name-status -m --first-parent --oneline ${revision}
            // 放弃的命令：show --cc -m --name-status --oneline ${revision}
            // 放弃的命令：diff --oneline  --name-status --find-renames=80% ${revision}^@ ${revision}
            try {
                var filesRes = await this._GetGitCommandResult(`diff --oneline  --name-status --find-renames=80% "${revision}^" "${revision}"`, this.repo_path, false);
                // 如果是show则需要去掉第一行
                var fileLines = filesRes.split('\n').filter(line => line);
            } catch (error) {
                // 如果是第一个提交，直接显示该提交的内容
                var filesRes = await this._GetGitCommandResult(`show --name-status --oneline ${revision}`);
                // 如果是show则需要去掉第一行
                var fileLines = filesRes.split('\n').slice(1).filter(line => line);
            }
            fileLines.forEach(line => {
                // line样式为：M utils.py 或 R80  old.txt -> new.txt
                // 忽略空行和以#开头的行
                if(!line || line.startsWith('#')){
                    return;
                }
                let [action, path] = line.split(/\s+/);     // 注意R80  old.txt -> new.txt会被错误解析为R80和old.txt
                // 如果action出现R数字，则需要去除后面的数字
                action = action.replace(/R\d+/, 'R');

                // 如果出现 ->,则需要处理copy_from,例如 R80  old.txt -> new.txt 或 R80  old.txt new.txt
                let copy_from = '';
                if(action === 'R'){
                    // 尝试匹配带箭头的格式
                    let copyMatch = line.match(/\S+\s+(.*)\s+->\s+(.*)/);
                    if(copyMatch){
                        path = copyMatch[2];
                        copy_from = copyMatch[1];
                    } else {
                        // 尝试匹配不带箭头的格式 (R{num} old_path new_path)
                        copyMatch = line.match(/\S+\s+(\S+)\s+(\S+.*)/);
                        if(copyMatch){
                            path = copyMatch[2];
                            copy_from = copyMatch[1];
                        } else {
                            MyLog.Error(`Invalid copy line: ${line}`);
                        }
                    }
                }
                
                // 如果filePath有值，则需要过滤掉非本文件路径的条目
                if(filePath && !path.startsWith(filePath)){
                    return;
                }
                // path需要带上branchtype和branch信息
                path = this._GenAbsPath(branchType, branch, '', path);
                files.push({ action: action, path, kind: 'file', text_mods: true, prop_mods: false, copy_from: copy_from });
            });
            return { revision, author, date:date_str, msg, files };
        }));
        if(!logs[0]){
            return [];
        }
        return logs;
    }

    async GetRepoProperty(file_url, version = 'HEAD') {
        var properties = {};
        // 返回值参考
        /*
        Entering 'lib/base'
        Path: lib/base
        URL: git@github.com:xunxun10/testrepo.base.git
        CommitID: 0e78804ddad71313dd065560c481cc2bd88640f4
        Branch: main

        ...
        */
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(file_url);
        
        // ``中的\注意需要转义
        var submodule = await this._GetGitCommandResult(`config --file .gitmodules --get-regexp '^submodule\\..*\\.path' | while read path_key path_val; do url_key=$(echo $path_key | sed 's/\\.path$/.url/');  url_val=$(git config --file .gitmodules --get "$url_key");  branch_key=$(echo $path_key | sed 's/\\.path$/.branch/');  branch_val=$(git config --file .gitmodules --get "$branch_key" || echo "N/A"); commit_id=$(git ls-files -s -- "$path_val" | cut -d' ' -f2); echo "Path: $path_val"; echo "URL: $url_val"; echo "Branch (configured): $branch_val"; echo "CommitID (expected): $commit_id";  echo; done`, this.repo_path, true, true);
        if(submodule.includes('Path')){
            // 将结果中的每段数据解析为一行，格式为  lib/base   git@github.com:xxx/testrepo.base.git    0e78804ddad71313dd065560c481cc2bd88640f4
            submodule = submodule.split('\n\n');
            submodule.forEach(function(item){
                // 去掉空行并按照空行切割
                let lines = item.split('\n').filter(line => line.trim());
                if(lines.length < 4){
                    return;
                }
                // 解析path、url、commit_id,数据为冒号后的字符串
                let path = lines[0].split(':').slice(1).join(':').trim();
                let url = lines[1].split(':').slice(1).join(':').trim();
                let commit_id = lines[2].split(':').slice(1).join(':').trim();
                let branch = lines[3].split(':').slice(1).join(':').trim();
                
                // 当path包含filePath时，才需要处理
                if(!path.includes(filePath)){
                    return;
                }
                if(!properties['submodule']){
                    properties['submodule'] = '';
                }
                properties['submodule'] += `${path}  ${url}  ${branch}  ${commit_id}\n`
            })
        }
        return properties;
    }

    /**
     * 获取版本的上一个版本号
     * @param {*} version 
     * @param {*} filePath 
     * @returns 
     */
    async _GetPreVersion(version, filePath) {
        // 注意此处${version}~1不能改为使用${version}^，^可能是windows下的转义字符
        let pre_version = await this._GetGitCommandResult(`rev-list -n 1 ${version}~1 -- ${filePath}`);
        //console.log('version:' + version + ';    pre_version: ' + pre_version);
        return pre_version.replace(/\s+/g, '');
    }

    /**
     * 获取两个版本及其之间的变更差异
     * @param {*} file_url 
     * @param {*} begin 注意，需要获取的变更包含begin版本的提交
     * @param {*} end  注意，需要获取的变更包含end版本的提交
     * @returns 
     */
    async GetRepoFileDiff(file_url, begin=null, end=null) {
        var pre_content = '', new_content = '';
        var begin_title = '', end_title = '';
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(file_url);
        await this._CloneOrUpdateRepo(branchType, branch, filePath);
        if(begin){
            // pre_version 为begin的上一个版本号，注意需要去除空行及空格
            var begin = await this._GetPreVersion(begin, filePath);
            var pre_content = await this.GetRepoFileContent(file_url, begin);
            begin_title = begin.substring(0, 7);
        }
        if(end){
            var new_content = await this.GetRepoFileContent(file_url, end);
            end_title = end.substring(0, 7);
        }
        return { title: `${filePath} ${begin_title}:${end_title}`, pre: pre_content, new: new_content };
    }

    /**
     * 获取两个版本及其之间的属性变更差异
     * @param {*} file_url 
     * @param {*} begin 注意，需要获取的变更包含begin版本的提交
     * @param {*} end 注意，需要获取的变更包含
     * @returns 
     */
    async GetRepoPropertyDiff(file_url, begin, end) {
        const [branchType, branch, filePath] = this._ExtractBranchFromUrl(file_url);
        await this._CloneOrUpdateRepo(branchType, branch, filePath);
        let pre_prop = await this.GetRepoProperty(file_url, begin);
        let new_prop = await this.GetRepoProperty(file_url, end);
        return { title: `${file_url} ${begin}:${end}`, pre: pre_prop, new: new_prop };
    }

    // 自动检测 Git Bash 路径
    _GetGitBashPath() {
        try {
            // 尝试常见安装路径
            const commonPaths = [
                'C:\\Program Files\\Git\\bin\\bash.exe',
                'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
                'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
            ];

            for (const path of commonPaths) {
                if (require('fs').existsSync(path)) {
                    return path;
                }
            }

            // 通过环境变量查找
            const gitPath = execSync('where git', { encoding: 'utf-8' }).split('\r\n')[0];
            if (gitPath) {
            return path.join(path.dirname(gitPath), 'bash.exe');
            }
            throw new Error('未找到 Git Bash，请确保已安装 Git');
        } catch {
            throw new Error('无法定位 Git Bash 路径');
        }
    }

    /**
     * 获取git submodule status获取子模块路径，返回一个dict，key为子模块路径，value为commitid
     */
    async _GetSubmodulePath(){
        let submodule_path_dict = {};
        try {
            // 使用 git submodule status 获取子模块状态
            const result = await this._GetGitCommandResult('submodule status', this.repo_path, false);
            if (!result || !result.trim()) {
                return submodule_path_dict;
            }

            // 解析结果，格式为：
            // +hash path (branch)
            // -hash path (branch)
            // 空格hash path (branch)
            const lines = result.trim().split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // 提取 commit ID 和路径
                // 格式：[+- ]?[commit_hash] [path] ([branch])
                const parts = trimmedLine.split(' ');
                if (parts.length >= 2) {
                    const commitId = parts[0].replace(/^[+-]/, ''); // 移除前缀+/-
                    let path = parts[1];
                    // 需要将path分割符按照os类型进行转换
                    if(this.os_type == 'windows'){
                        path = path.replace(/\//g, '\\');
                    }
                    submodule_path_dict[path] = commitId;
                }
            }
        } catch (error) {
            MyLog.Warn(`获取子模块状态失败: ${error.message}`);
        }
        return submodule_path_dict;
    }
}

module.exports = GitCommandApi;
