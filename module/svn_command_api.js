const https = require('https'); 
const Buffer = require('buffer').Buffer; // 如果使用 Node.js v12+，需要引入 Buffer 模块 
const XmlParser = require('fast-xml-parser');
const {MyDate, MyUnit} = require('../util/my_util')
const MyLog = require('../util/my_log')

/**
 * 通过svn命令行工具获取SVN远程仓库的信息，需要确保主机上已经安装svn客户端
 */
class SvnCommandApi{
    constructor(repo_url, user, password, os_type) {
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
        MyLog.Info(`svn command api init, repo: ${repo_url}, fixed_version: ${this.svn_version}, os type:${this.os_type}`);
    }

    GetCacheStatus(){
        return null;
    }

    /**
     * 获取repo根目录，即trunk、branches、tags的上一级目录
     * @param {*} repo_url 
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
            var cmd_str = `${svn_exe} --non-interactive --trust-server-cert --username ${this.user} --password ${this.password} ${cmd_params}`;
            MyLog.Debug('exec cmd: ' + cmd_str, true);
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
        // 需要替换掉密码相关敏感信息
        msg = msg.replace(/--password\s+\S+/, '--password ******');
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
            let name = entry.name;
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

        let res = await this._GetSvnCommandResult(`list ${repo_url} --xml`).catch(SvnCommandApi._ProcessCommandError);
        let res_obj = SvnCommandApi._ParseRepoTree(res);
        res_obj.url = repo_url;

        // 计算base及path，保持与webdav接口一致，base为仓库根目录（以/svn/分割），path为根目录下的剩余路径
        var idx = repo_url.indexOf('/svn/');
        var base_and_path = repo_url.substring(idx + 5).split('@')[0].split('/');
        res_obj.base = base_and_path[0];   // base_and_path第一个目录
        res_obj.path = '/' + base_and_path.slice(1).join('/');  // base_and_path剩余部分

        if(!this.server_root){
            // 服务器根目录为url中/svn/之前的部分
            let idx = repo_url.indexOf('/svn/');
            this.server_root = repo_url.substring(0, idx);
            this.repo_root = this.server_root + "/svn/" + res_obj.base;

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

        let res = await this._GetSvnCommandResult(`cat ${des_url}`).catch(SvnCommandApi._ProcessCommandError);
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

        let res = await this._GetSvnCommandResult(`export --force ${des_url} ${dest_path}`).catch(SvnCommandApi._ProcessCommandError);
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
        let cmd_params = `log ${repo_url} ${ver_str} ${limit_str} --stop-on-copy --xml -v`;
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

        let res = await this._GetSvnCommandResult(`proplist -v ${des_url} --xml`).catch(SvnCommandApi._ProcessCommandError);
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