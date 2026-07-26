const https = require('https'); 
const Buffer = require('buffer').Buffer; // 如果使用 Node.js v12+，需要引入 Buffer 模块 
const XmlParser = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {MyDate, MyUnit, MyCheck} = require('../util/my_util')
const MyLog = require('../util/my_log')
const MyFile = require('../util/my_file');

/**
 * 通过svn命令行工具获取SVN远程仓库的信息，需要确保主机上已经安装svn客户端
 *
 * ─── 两个"根"的概念 ───
 *
 * 仓库根 (Repo Root)：
 *   SVN 服务器上的真实仓库根，由 URL 中 /svn/ 后第一级目录决定。
 *   例如 URL = "http://xlsvn:8888/svn/myapps/easyviptool/trunk"
 *   → 仓库根 = "http://xlsvn:8888/svn/myapps"
 *   由 GetRepoTree() 设置在 this.repo_root 上，用于树结构浏览。
 *
 * 项目根 (Project Root)：
 *   用户视角的逻辑项目根，即 trunk/branches/tags 的上一级目录。
 *   例如 URL = "http://xlsvn:8888/svn/myapps/easyviptool/trunk"
 *   → 项目根 = "http://xlsvn:8888/svn/myapps/easyviptool"
 *   由 GetRepoRoot(url) 方法返回，用于缓存 key 和路径计算。
 *
 * 缓存以项目根为 key 存储在 this._cacheMap 中：
 *   projectRoot → { cacheDir, hash }
 *   同一项目的 trunk 和不同 branches 共享同一缓存目录（通过 svn switch 切换内容）。
 */
class SvnCommandApi{
    constructor(repo_url, user, password, os_type, cache_root_dir = null) {
        // 如果repo_url指定svn版本则拆解为url和版本号
        var idx = repo_url.indexOf('@');
        if(idx !== -1){
            this.repo_url = repo_url.substring(0, idx);
            this.svn_version = `@${repo_url.substring(idx + 1)}`;
        }else{
            this.repo_url = repo_url;
            this.svn_version = null;
        }
        this.repo_root = null;   // 仓库根目录，真实repo，非逻辑repo
        this.server_root = null;  // 服务器根目录，即/svn/之前的部分
        this.user = user;
        this.password = password;

        this.os_type = os_type;
        this.cache_root_dir = cache_root_dir;  // 仅保存，不 InitCache
        this._cacheMap = {};   // projectRoot → { cacheDir, hash }

        MyLog.Info(`svn command api init, repo: ${repo_url}, fixed_version: ${this.svn_version}, os type:${this.os_type}`);
    }

    /**
     * 获取缓存状态
     * @param {string} [searchPath] - 搜索路径，用于检查指定项目根是否有缓存
     * @returns {object|null}
     */
    GetCacheStatus(searchPath){
        // 有搜索路径时，按项目根精确查找
        if (searchPath) {
            const projectRoot = this.GetRepoRoot(searchPath);
            // 1. 查 _cacheMap 对照表
            if (this._cacheMap[projectRoot]) {
                return { local_path: '', br_name: '', up_time: '' };
            }
            // 2. 查磁盘上对应项目根的缓存目录
            if (this.cache_root_dir) {
                const cacheDir = this._GetCacheDir(projectRoot);
                if (cacheDir && fs.existsSync(path.join(cacheDir, '.svn'))) {
                    // 磁盘上有缓存，记录到 _cacheMap 供后续使用
                    this._cacheMap[projectRoot] = {
                        cacheDir,
                        hash: crypto.createHash('md5').update(projectRoot).digest('hex')
                    };
                    return { local_path: '', br_name: '', up_time: '' };
                }
            }
            return null;
        }

        // 无搜索路径：检查 _cacheMap 是否有任意条目（向后兼容）
        for (var key in this._cacheMap) {
            if (this._cacheMap.hasOwnProperty(key)) {
                return { local_path: '', br_name: '', up_time: '' };
            }
        }
        return null;
    }

    /**
     * 获取项目根对应的缓存目录路径
     * @param {string} projectRoot - 项目根 URL
     * @returns {string|null}
     */
    _GetCacheDir(projectRoot) {
        if (!this.cache_root_dir || !projectRoot) return null;
        const hash = crypto.createHash('md5').update(projectRoot).digest('hex');
        return path.join(this.cache_root_dir, hash + '.svn');
    }

    /**
     * 获取或创建项目根对应的缓存条目（见类注释"两个根的概念"）
     * @param {string} projectRoot - 项目根 URL（GetRepoRoot 返回值）
     * @returns {{ cacheDir: string, hash: string }|null}
     */
    _GetCacheEntry(projectRoot) {
        if (!this.cache_root_dir || !projectRoot) return null;
        if (this._cacheMap[projectRoot]) return this._cacheMap[projectRoot];

        const cacheDir = this._GetCacheDir(projectRoot);
        if (!cacheDir) return null;
        MyFile.MkDir(cacheDir);

        const hash = crypto.createHash('md5').update(projectRoot).digest('hex');
        const entry = { cacheDir, hash };
        this._cacheMap[projectRoot] = entry;
        return entry;
    }

    /**
     * 获取项目根 URL（parent of trunk/branches/tags）
     */
    GetRepoRootUrl() {
        return this.GetRepoRoot(this.repo_url);
    }

    /**
     * 获取分支级 URL（trunk 或 branches/xxx 或 tags/xxx），基于实例的 repo_url
     */
    _GetBranchRootUrl() {
        const rootUrl = this.GetRepoRoot(this.repo_url);
        const remaining = this.repo_url.substring(rootUrl.length);
        const parts = remaining.replace(/^\//, '').split('/');
        if (parts.length >= 1) {
            if (parts[0] === 'trunk') {
                return rootUrl + '/trunk';
            }
            if ((parts[0] === 'branches' || parts[0] === 'tags') && parts.length >= 2) {
                return rootUrl + '/' + parts[0] + '/' + parts[1];
            }
        }
        return this.repo_url;
    }

    /**
     * 从任意 URL 中提取分支级路径（trunk 或 branches/xxx 或 tags/xxx）
     */
    _ExtractBranchRootFromUrl(searchUrl) {
        if (!searchUrl) return this._GetBranchRootUrl();
        const rootUrl = this.GetRepoRoot(searchUrl);
        const remaining = searchUrl.substring(rootUrl.length);

        const trunkIdx = remaining.indexOf('/trunk');
        if (trunkIdx !== -1) {
            return rootUrl + remaining.substring(0, trunkIdx + '/trunk'.length);
        }

        const brMatch = remaining.match(/\/branches\/[^/]+/);
        if (brMatch) {
            return rootUrl + remaining.substring(0, brMatch.index + brMatch[0].length);
        }

        const tagMatch = remaining.match(/\/tags\/[^/]+/);
        if (tagMatch) {
            return rootUrl + remaining.substring(0, tagMatch.index + tagMatch[0].length);
        }

        return this._GetBranchRootUrl();
    }

    /**
     * 确保本地副本就绪：未 checkout 则 checkout，已存在则按需 update 或 switch
     * 缓存信息从 _cacheMap 对照表获取
     * @param {string|null} targetUrl - 目标 checkout URL
     */
    async EnsureRepoReady(targetUrl = null) {
        const checkoutUrl = targetUrl || this._GetBranchRootUrl();
        const projectRoot = this.GetRepoRoot(checkoutUrl);
        const cacheEntry = this._GetCacheEntry(projectRoot);
        if (!cacheEntry) return;

        const localPath = cacheEntry.cacheDir;
        const hasWorkingCopy = fs.existsSync(path.join(localPath, '.svn'));
        if (!hasWorkingCopy) {
            await this._CheckoutRepo(checkoutUrl, localPath, projectRoot);
        } else {
            const currentUrl = await this._GetWorkingCopyUrl(localPath);
            if (currentUrl && currentUrl !== checkoutUrl) {
                MyLog.Info(`svn switch: ${currentUrl} -> ${checkoutUrl}`);
                await this._GetSvnCommandResult(`switch "${checkoutUrl}" "${localPath}"`).catch(SvnCommandApi._ProcessCommandError);
                this._SaveLastUpdateTime(projectRoot);
                this._SaveRepoInfo(projectRoot);
            } else {
                await this._UpdateRepo(localPath, projectRoot);
            }
        }
    }

    /**
     * 获取工作副本 URL
     * @param {string} localPath - 工作副本路径
     */
    async _GetWorkingCopyUrl(localPath) {
        try {
            const res = await this._GetSvnCommandResult(`info --show-item url "${localPath}"`);
            if (res) return res.trim();
        } catch (e) {
            MyLog.Debug(`svn info failed, fallback to entries: ${e.message}`);
        }
        const entriesPath = path.join(localPath, '.svn', 'entries');
        if (fs.existsSync(entriesPath)) {
            try {
                const content = fs.readFileSync(entriesPath, 'utf8');
                const lines = content.split('\n');
                if (lines.length > 0 && lines[0].trim()) {
                    return lines[0].trim();
                }
            } catch (e) {
                MyLog.Debug(`read svn entries failed: ${e.message}`);
            }
        }
        return null;
    }

    /**
     * Checkout 指定 URL 到本地缓存
     * @param {string} url - checkout 目标 URL
     * @param {string} localPath - 本地路径
     * @param {string} projectRoot - 项目根 URL
     */
    async _CheckoutRepo(url, localPath, projectRoot) {
        MyLog.Info(`svn checkout: ${url} -> ${localPath}`);
        await this._GetSvnCommandResult(`checkout "${url}" "${localPath}"`).catch(SvnCommandApi._ProcessCommandError);
        this._SaveLastUpdateTime(projectRoot);
        this._SaveRepoInfo(projectRoot);
        MyLog.Info(`svn checkout completed: ${localPath}`);
    }

    /**
     * 更新本地副本
     * @param {string} localPath - 本地路径
     * @param {string} projectRoot - 项目根 URL
     */
    async _UpdateRepo(localPath, projectRoot) {
        if (!localPath || !fs.existsSync(localPath)) return;

        const entry = this._cacheMap[projectRoot];
        if (!entry) return;
        const lastUpdateFile = path.join(this.cache_root_dir, entry.hash + '.last-update');
        const now = new Date();

        // 检查上次更新时间（默认跳过 24 小时内）
        if (fs.existsSync(lastUpdateFile)) {
            const lastUpdateContent = fs.readFileSync(lastUpdateFile, 'utf-8').trim();
            const lastUpdateTime = new Date(lastUpdateContent);
            const diffHours = (now - lastUpdateTime) / (1000 * 60 * 60);
            if (diffHours < 24) {
                MyLog.Debug(`svn update skipped, last update was ${diffHours.toFixed(1)} hours ago`);
                return;
            }
        }

        MyLog.Info(`svn update: ${localPath}`);
        await this._GetSvnCommandResult(`update "${localPath}"`).catch(SvnCommandApi._ProcessCommandError);
        this._SaveLastUpdateTime(projectRoot);
        this._SaveRepoInfo(projectRoot);
        MyLog.Info(`svn update completed: ${localPath}`);
    }

    /**
     * 保存仓库 URL 到 info 文件
     * @param {string} projectRoot - 项目根 URL
     */
    _SaveRepoInfo(projectRoot) {
        const entry = this._cacheMap[projectRoot];
        if (!entry) return;
        try {
            const infoFile = path.join(this.cache_root_dir, entry.hash + '.info');
            if (!fs.existsSync(infoFile)) {
                fs.writeFileSync(infoFile, projectRoot);
            }
        } catch (e) {
            MyLog.Warn(`save svn repo info failed: ${e.message}`);
        }
    }

    /**
     * 保存上次更新时间
     * @param {string} projectRoot - 项目根 URL
     */
    _SaveLastUpdateTime(projectRoot) {
        const entry = this._cacheMap[projectRoot];
        if (!entry) return;
        try {
            const lastUpdateFile = path.join(this.cache_root_dir, entry.hash + '.last-update');
            fs.writeFileSync(lastUpdateFile, new Date().toISOString());
        } catch (e) {
            MyLog.Warn(`save last update time failed: ${e.message}`);
        }
    }

    /**
     * 从本地 checkout 目录递归列出所有文件
     * @param {string} relativePath - 相对路径
     * @param {string} projectRoot - 项目根 URL（从对照表取缓存目录）
     * @returns {Promise<Array>} 文件列表 [{text, path, size, date}]
     */
    async GetLocalFileList(relativePath = '', projectRoot) {
        const cacheEntry = this._cacheMap[projectRoot];
        if (!cacheEntry) {
            throw new Error('svn cache not initialized for project root: ' + projectRoot);
        }
        const searchPath = relativePath
            ? path.join(cacheEntry.cacheDir, relativePath)
            : cacheEntry.cacheDir;
        const files = [];
        await this._walkDirAsync(searchPath, files, '');
        return files;
    }

    /**
     * 异步递归遍历目录（避免同步 fs 阻塞事件循环）
     * @param {string} dir - 当前目录路径
     * @param {Array} results - 结果数组
     * @param {string} baseRelative - 当前相对路径前缀
     */
    async _walkDirAsync(dir, results, baseRelative) {
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relative = baseRelative
                ? baseRelative.replace(/\\/g, '/') + '/' + entry.name
                : entry.name;

            if (entry.isDirectory()) {
                if (entry.name === '.svn') continue;
                await this._walkDirAsync(fullPath, results, relative);
            } else {
                try {
                    const stat = await fs.promises.stat(fullPath);
                    results.push({
                        text: entry.name,
                        path: relative.replace(/\\/g, '/'),
                        size: stat.size,
                        date: stat.mtime ? MyDate.GetDateStr(stat.mtime, true) : '',
                    });
                } catch (e) {
                    // 跳过无法读取的文件
                }
            }
        }
    }

    /**
     * 搜索仓库文件 - 公开方法
     * @param {string} searchUrl - 搜索起始 URL
     * @param {RegExp} pattern - 编译后的正则
     * @returns {Promise<{matched: array}>}
     */
    async SearchFiles(searchUrl, pattern) {
        // 1. 从搜索路径提取分支级 URL，切换缓存到该级
        const targetUrl = this._ExtractBranchRootFromUrl(searchUrl);
        const projectRoot = this.GetRepoRoot(targetUrl);
        await this.EnsureRepoReady(targetUrl);

        // 2. 相对路径从 targetUrl 算（缓存 switch 后的实际文件层级）
        let relativePath = '';
        if (searchUrl.startsWith(targetUrl)) {
            relativePath = searchUrl.substring(targetUrl.length + 1);
        }

        const RepoSearch = require('./repo_search');
        return RepoSearch.SearchInSvn(this, relativePath, pattern, projectRoot);
    }

    /**
     * 获取项目根（Project Root），即 trunk/branches/tags 的上一级目录。
     * 与 this.repo_root（仓库根/Repo Root）不同，详见类注释"两个根的概念"。
     * @param {*} repo_url 
     * @returns {string} 项目根 URL
     */
    GetRepoRoot(repo_url){
        // 找到第一个trunk等目录位置，返回上级目录
        var idx = repo_url.indexOf('/trunk');
        if(idx !== -1){
            return repo_url.substring(0, idx);
        }else{
            idx = repo_url.indexOf('/branches');
            if(idx!== -1){
                return repo_url.substring(0, idx);
            }else{
                idx = repo_url.indexOf('/tags');
                if(idx!== -1){
                    return repo_url.substring(0, idx);
                }else{
                    return repo_url;
                }
            }
        }
    }

    async _GetSvnCommandResult(cmd_params){
        return new Promise((resolve, reject) => {
            const exec = require('child_process').exec;
            if(this.os_type == 'windows'){
                var svn_exe = 'svn.exe';
            }else{
                var svn_exe = 'svn';
            }
            // 密码暴露在命令行中容易泄露，后续需要择期优化
            var auth_part = '';
            if (!MyCheck.IsEmpty(this.user)) {
                auth_part = `--username ${this.user}`;
                if (!MyCheck.IsEmpty(this.password)) {
                    auth_part += ` --password ${this.password}`;
                }
            }
            var cmd_str = `${svn_exe} --non-interactive --trust-server-cert ${auth_part} ${cmd_params}`;
            // 密码脱敏后再日志
            var logCmd = cmd_str.replace(/--password\s+\S+/g, '--password ******');
            MyLog.Debug('exec cmd: ' + logCmd, true);
            // 注意设置缓冲区大小最大为100MB，否则读取大文件时会报错：stdout maxBuffer length exceeded
            exec(cmd_str, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
                if(error){
                    reject(error);
                }else{
                    // 获取输出的字符串
                    resolve(stdout.toString());
                }
            });
        });
    }

    static _ParseXmlToJson(data){
        const options = {
            attributeNamePrefix: "@", // 在属性名称前面添加@前缀
            ignoreAttributes: false, // 不能忽略属性
            parseZeroInvalidTags: true, // 解析零值标签
            textNodeConversion: true, // 转换文本节点
        };
        this.xml_parser = new XmlParser.XMLParser(options);
        // 需要保留节点名字并解析节点中的属性
        let jsonObj = this.xml_parser.parse(data);
        return jsonObj;
    }
    
    static _ProcessCommandError(error){
        var msg = `${error.message}`;
        // 需要替换掉密码相关敏感信息（加 g 标志处理所有出现）
        msg = msg.replace(/--password\s+\S+/g, '--password ******');
        // 如果换行符前面的文字不是标点符号，则替换为一个.
        msg = msg.replace(/([^.;\n\r,。；])\s*\n/g, '$1; \n');
        MyLog.Error(msg);
        error.message = msg;
        throw error;
    }

    static _ParseRepoTree(data){
        /* 输入数据data结构类似
            <?xml version="1.0" encoding="UTF-8"?>
            <lists>
            <list path=".">
            <entry kind="dir">
                <name>.vscode</name>
                <commit revision="6">
                    <author>xxx</author>
                    <date>2024-06-23T03:06:26.566890Z</date>
                </commit>
            </entry>
            <entry kind="file">
                <name>LICENSE</name>
                <size>1074</size>
                <commit revision="6">
                    <author>xxx</author>
                    <date>2024-06-23T03:06:26.566890Z</date>
                </commit>
            </entry>
            </list>
            </lists>
         */
        let jsonObj = this._ParseXmlToJson(data);
        // console.log('json: ' + JSON.stringify(jsonObj));   // debug console
        let entries = jsonObj.lists.list.entry;
        let tree = {
            base: '', path: '', dirs: [], files: []
        };
        if(entries === undefined){
            return tree;
        }
        
        // 需要先判断是否为数组
        if(!Array.isArray(entries)){
            entries = [entries];
        }
        for(let i = 0; i < entries.length; i++){
            let entry = entries[i];
            let kind = entry['@kind'];
            let name = entry.name != null ? String(entry.name) : '';
            let commit = entry.commit;
            let revision = commit['@revision'];
            let author = commit.author;
            let date = this._ParseDate(commit.date);
            if(kind === 'dir'){
                tree.dirs.push({text: name, date: date, children: ['.']});
            }else{
                // 如果是文件，增加size属性，转换为KB，MB，GB等单位
                let size_str = MyUnit.FileSizeStr(entry.size);  // 默认单位为B
                tree.files.push({text: name, revision: revision, author: author, date: date, size: size_str, size_num: parseInt(entry.size)});
            }
        }
        return tree;
    }


    /**
     * 获取基础数据结构，包括路径对应一级目录结构、仓库根目录、服务器根目录等
     * @param {*} repo_url 仓库url，例如 http://mysvn:8888/svn/electron_apps/repo_viewer/trunk
     * @returns json对象，结构如下：
     * {
     *   "url":"http://mysvn:8888/svn/electron_apps/repo_viewer/trunk",
     *   "base":"electron_apps",
     *   "path":"/repo_viewer/trunk",
     *   "dirs":[ {"text":".vscode","date":"2024-06-23 11:06:26","children":["."]},...],
     *   "files":[ {"text":"LICENSE","revision":"6","author":"xxx","date":"2024-06-23 11:06:26","size":"1.05KB"},...], ...},
     *   "server_root":"http://mysvn:8888",
     *   "repo_root":"http://mysvn:8888/svn/electron_apps"
     * }
     */
    async GetRepoTree(repo_url = null){
        if(!repo_url){
            repo_url = this.repo_url;
        }
        if(this.svn_version){
            repo_url += this.svn_version;
        }

        let res = await this._GetSvnCommandResult(`list "${repo_url}" --xml`).catch(SvnCommandApi._ProcessCommandError);
        let res_obj = SvnCommandApi._ParseRepoTree(res);
        res_obj.url = repo_url;

        // 计算仓库根（Repo Root）：/svn/ 后第一级目录为仓库根，与项目根（Project Root）不同
        // 见类注释"两个根的概念"
        var idx = repo_url.indexOf('/svn/');
        var base_and_path = repo_url.substring(idx + 5).split('@')[0].split('/');
        res_obj.base = base_and_path[0];   // base_and_path第一个目录
        res_obj.path = '/' + base_and_path.slice(1).join('/');  // base_and_path剩余部分

        if(!this.server_root){
            // 服务器根目录为url中/svn/之前的部分
            let idx = repo_url.indexOf('/svn/');
            this.server_root = repo_url.substring(0, idx);
            this.repo_root = this.server_root + "/svn/" + res_obj.base;  // 仓库根（Repo Root）

            MyLog.Info(`repo info init, repo url: ${repo_url}, server root: ${this.server_root}, repo_root: ${this.repo_root}`);  // TODO debug
        }

        res_obj.server_root = this.server_root;
        res_obj.repo_root = this.repo_root;

        return res_obj;
    }

    /**
     * 刷新数据，由于svn不使用缓存机制，因此直接返回即可
     * @param {*} repo_url 
     */
    async RefreshRepoTree(repo_url){
        return;
    }

    async GetRepoFileContent(file_url, version=null){
        if(this.svn_version && version === null){
            file_url += this.svn_version;
        }
        MyLog.Info('get content of: ' + file_url + (version ? ' with version: ' + version : ''));
        var des_url = file_url;
        // 如果指定版本，则需要在url中repo_root后添加版本号，地址类似 http://svn.mine/svn/electron_apps/!svn/ver/9/repo_viewer/trunk/module/svn_web_api.js
        if(version !== null){
            des_url = `${des_url}@${version}`;
        }

        let res = await this._GetSvnCommandResult(`cat "${des_url}"`).catch(SvnCommandApi._ProcessCommandError);
        // console.log(res.data);  // debug console
        return res;
    }

    // 导出文件到指定位置，dest_path为目标文件位置
    async ExportRepoFile(file_url, dest_path, version=null){
        if(this.svn_version && version === null){
            file_url += this.svn_version;
        }
        MyLog.Info('get file of: ' + file_url + (version ? ' with version: ' + version : ''));
        var des_url = file_url;
        // 如果指定版本，则需要在url中repo_root后添加版本号，地址类似 http://svn.mine/svn/electron_apps/!svn/ver/9/repo_viewer/trunk/module/svn_web_api.js
        if(version !== null){
            des_url = `${des_url}@${version}`;
        }

        let res = await this._GetSvnCommandResult(`export --force "${des_url}" "${dest_path}"`).catch(SvnCommandApi._ProcessCommandError);
        // console.log(res.data);  // debug console
        return res;
    }

    /**
     * 获取提交日志及每次提交涉及的文件列表
     * @param {*} repo_url 
     * @param {*} start_rev 起始版本号，不包含该版本
     * @param {*} end_rev 结束版本号，不包含该版本
     * @returns 
     */
    async GetRepoLog(repo_url, start_rev=null, end_rev=null){
        if(this.svn_version){
            repo_url += this.svn_version;
        }
        MyLog.Info('get log of: ' + repo_url)

        let ver_str = '', limit_str='', limit_num = 50;
        if (start_rev && end_rev){
            end_rev = parseInt(end_rev) - 1;
            start_rev = parseInt(start_rev) + 1;
            if (start_rev >= end_rev){
                return [];
            }
            ver_str = `-r ${end_rev}:${start_rev}`;
        }else if(!start_rev && end_rev){
            end_rev = parseInt(end_rev) - 1;
            start_rev = end_rev - 1 - limit_num;
            if(start_rev < 0){
                start_rev = 0;
            }
            if (start_rev == 0 && end_rev == 0){
                return [];
            }
            ver_str = `-r ${end_rev}:${start_rev}`;
        }else{
            limit_str = `--limit ${limit_num}`;
        }
        let cmd_params = `log "${repo_url}" ${ver_str} ${limit_str} --stop-on-copy --xml -v`;
        let res = await this._GetSvnCommandResult(cmd_params).catch(SvnCommandApi._ProcessCommandError);
        // console.log(res);  // debug console

        let jsonObj = SvnCommandApi._ParseXmlToJson(res);
        /**
         * 原始数据格式如下：
        <log>
          <logentry revision="5">
            <author>xxxx</author>
            <date>2024-06-23T03:04:23.109994Z</date>
            <paths>
            <path action="A" prop-mods="false" text-mods="false" kind="dir">/app_tmpl/trunk/.vscode</path>
            ...
            </paths>
            <msg>xxx</msg>
          </logentry>
        </log>
         */
        //console.log(JSON.stringify(jsonObj));  // debug console
        let res_obj = [];
        let logs = jsonObj['log']['logentry'];
        if(logs === undefined){
            return res_obj;
        }
        if(!Array.isArray(logs)){
            logs = [logs];
        }

        for(let i = 0; i < logs.length; i++){
            let log = logs[i];
            let item = {};
            item['revision'] = log['@revision'];
            item['date'] = SvnCommandApi._ParseDate(log['date']);
            item['msg'] = log['msg'];
            item['author'] = log['author'];
            item['files'] = [];
            if(log.hasOwnProperty('paths')){
                let paths = log['paths']['path'];
                if(!Array.isArray(paths)){
                    paths = [paths];
                }
                for(let j = 0; j < paths.length; j++){
                    let path = paths[j];
                    let copy_from = "";
                    if(path.hasOwnProperty('@copyfrom-path')){
                        copy_from = path["@copyfrom-path"] + "@" + path["@copyfrom-rev"]
                    }
                    let path_node = {action: path["@action"], path: path["#text"], kind: path['@kind'], text_mods:path['@text-mods'], prop_mods: path['@prop-mods'], copy_from:copy_from}
                    item['files'].push(path_node);
                }
            }
            res_obj.push(item);
        }
        return res_obj;
    }

    /**
     * 获取SVN文件属性信息
     * @param {*} file_url 
     * @returns 
     */
    async GetRepoProperty(file_url, version=null){
        if(this.svn_version && version === null){
            file_url += this.svn_version;
        }
        var des_url = file_url;
        if(version !== null){
            des_url = `${file_url}@${version}`;
        }

        let res = await this._GetSvnCommandResult(`proplist -v "${des_url}" --xml`).catch(SvnCommandApi._ProcessCommandError);
        /**
         * 返回数据结构如下：
        <properties>
        <target path="http://xxx/svn/test/trunk">
            <property name="svn:externals">http://xxxx/trunk lib/repo_viewer&#13;
        http://xxxxxx/trunk lib/tmpl&#13;
            </property>
        </target>
        </properties>
         */

        let jsonObj = SvnCommandApi._ParseXmlToJson(res);

        // console.log(JSON.stringify(jsonObj));  // debug console

        let res_obj = {};
        if(jsonObj['properties']['target'] === undefined || jsonObj['properties']['target']['property'] === undefined){
            return res_obj;
        }
        let properties = jsonObj['properties']['target']['property'];
        if(!Array.isArray(properties)){
            properties = [properties];
        }
        // 找到href与file_url相同的response，href为url去掉server_root的部分
        for(let i = 0; i < properties.length; i++){
            let cur_propert = properties[i];
            let key = cur_propert['@name'];
            // 注意转换 &#13 等特殊字符
            res_obj[key] = cur_propert["#text"].replace(/&#13;/g, "").replace(/&#10;/g, "\n").replace(/&#9;/g, "\t");
        }
        // console.log(JSON.stringify(res_obj));  // debug console

        return res_obj;
    }

    /**
     * 获取两个版本及其之间的变更差异
     * @param {*} file_url 
     * @param {*} begin 注意，需要获取的变更包含begin版本的提交
     * @param {*} end  注意，需要获取的变更包含end版本的提交
     * @returns 
     */
    async GetRepoFileDiff(file_url, begin, end){
        var pre_content = '', new_content = '';
        if(begin !== null){
            begin = parseInt(begin);
            pre_content = await this.GetRepoFileContent(file_url, begin - 1 );
        }
        if(end !== null){
            end = parseInt(end);
            var new_content = await this.GetRepoFileContent(file_url, end);
        }
        return {title:`${file_url} ${begin}:${end}`, pre: pre_content, new: new_content};
    }

    /**
     * 获取两个版本及其之间的属性变更差异
     * @param {*} file_url 
     * @param {*} begin 注意，需要获取的变更包含begin版本的提交
     * @param {*} end 注意，需要获取的变更包含
     * @returns 
     */
    async GetRepoPropertyDiff(file_url, begin, end){
        var pre_prop = '', new_prop = '';
        if(begin !== null){
            begin = parseInt(begin);
            pre_prop = await this.GetRepoProperty(file_url, begin - 1 );
            pre_prop = JSON.stringify(pre_prop, null, 2).replace(/\\n/g, '\n');
        }
        if(end !== null){
            end = parseInt(end);
            new_prop = await this.GetRepoProperty(file_url, end);
            new_prop = JSON.stringify(new_prop, null, 2).replace(/\\n/g, '\n');
        }
        return {title:`${file_url} ${begin}:${end}`, pre: pre_prop, new: new_prop};
    }

    // 其他工具函数
    static _ParseDate(svn_date){
        return MyDate.GetDateStr(new Date(svn_date), true);
    }
}

module.exports = SvnCommandApi;