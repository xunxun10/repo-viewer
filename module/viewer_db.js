const MyDb = require('../util/my_sldb')
const MyLog = require('../util/my_log')
const {MyString} = require('../util/my_util')

/**
 * 操作浏览器数据库相关信息
 * @class ViewerDb
 * @constructor
 * @example
 * const ViewerDb = require('./viewer_db')
 */
class ViewerDb{
    /**
     * 初始化
     * @param {*} repo_url 
     * @param {*} user 
     * @param {*} password 
     * @param {*} api_type api类型，可选 webdav,command
     */
    constructor() {
        this.db = null;
    }

    async Init(db_file){
        this.db = new MyDb(db_file, "create table if not exists repo_viewer(id INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT, nickname TEXT);");
        this.db.Run('create table if not exists info(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT);');
        this.db.Run('create table if not exists repo_access(id INTEGER PRIMARY KEY AUTOINCREMENT, repo_url TEXT, access_time TEXT);');

        // 如果不存在nickname字段，则增加
        let res = await this.db.Query('PRAGMA table_info(repo_viewer)');
        let has_nickname = false;
        for(let i=0; i<res.length; i++){
            if(res[i].name == 'nickname'){
                has_nickname = true;
                break;
            }
        }
        if(!has_nickname){
            await this.db.Run('alter table repo_viewer add column nickname TEXT');
        }
    }

    /**
     * 记录仓库访问时间，用于频率统计
     * @param {string} repo_url 
     */
    async AddRepoAccessRecord(repo_url) {
        await this.db.Run('insert into repo_access(repo_url, access_time) values(?, ?)', [repo_url, new Date().toISOString()]);
    }

    /**
     * 获取最近N天内最常用的M个仓库
     * @param {number} days 天数，默认15天
     * @param {number} count 返回数量，默认6个
     * @param {string|null} repo_type 仓库类型过滤，'git'或'svn'，null为不限
     * @returns {Array<string>} 仓库URL列表
     */
    async GetFrequentlyUsedRepos(days = 15, count = 6, repo_type = null) {
        let cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        let res = await this.db.Query(
            'select repo_url, count(*) as freq from repo_access where access_time > ? group by repo_url order by freq desc',
            [cutoff]
        );
        let repos = res.map(r => r.repo_url);
        if (repo_type === 'git') {
            repos = repos.filter(url => url.endsWith('.git') || url.includes('git@') || url.includes('.git/'));
        }
        return repos.slice(0, count);
    }

    /**
     * 获取最近访问的仓库列表（按访问时间倒序，去重）
     * @param {number} limit 返回数量，默认30
     * @returns {Array<string>} 仓库URL列表
     */
    async GetRecentAccessedRepos(limit = 30) {
        let res = await this.db.Query(
            'select repo_url, max(access_time) as last_access from repo_access group by repo_url order by last_access desc limit ?',
            [limit]
        );
        return res.map(r => r.repo_url);
    }

    /**
     * 清理repo_access表中超过1年的记录
     */
    async CleanupRepoAccess() {
        const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        await this.db.Run('delete from repo_access where access_time < ?', [cutoff]);
    }

    /**
     * 获取保存的仓库列表
     * @returns {Array} 返回仓库列表
     */
    async GetRepoList(){
        let res = await this.db.Query('select * from repo_viewer');
        return res;
    }
    /**
     * 增加repo
     * @param {*} repo_url 
     * @param {*} nickname 
     * @returns 
     */
    async AddRepo(repo_url, nickname=''){
        let res = await this.db.Query('select * from repo_viewer where repo = ?', [repo_url]);
        if(res.length < 1){
            await this.db.Run('insert into repo_viewer(repo, nickname) values(?, ?)', [repo_url, nickname]);
        }
        return true;
    }
    /**
     * 删除repo
     * @param {*} repo_url 
     * @returns 
     */
    async DelRepo(repo_url){
        await this.db.Run('delete from repo_viewer where repo = ?', [repo_url]);
        return true;
    }


    /**
     * 提供info表通用的get和set方法，value中为对象转为的json字符串
     * @param {*} key 
     * @returns obj
     */
    async _GetInfo(key){
        let res = await this.db.Query('select * from info where key = ?', [key]);
        if(res.length > 0){
            // 将json字符串转为数据对象
            var obj = JSON.parse(res[0].value);
            return obj;
        }
        return null;
    }

    /**
     * 将对象转为json字符串存储到info表
     * @param {*} key 
     * @param {*} value 
     * @returns 
     */
    async _SetInfo(key, value_obj){
        // 将对象转为json字符串
        var value = JSON.stringify(value_obj);
        let res = await this.db.Query('select * from info where key = ?', [key]);
        if(res.length > 0){
            await this.db.Run('update info set value = ? where key = ?', [value, key]);
        }else{
            await this.db.Run('insert into info(key, value) values(?, ?)', [key, value]);
        }
        return true;
    }

    /**
     * 使用info表存储accessed repo，key为accessed_repo
     * @returns Array[string] 返回访问过的仓库列表
     */
    async GetAccessedRepos(){
        return await this._GetInfo('accessed_repo');
    }
    /**
     * 增加访问过的仓库
     * @param {string} repo_url 
     * @returns 如果数据有变化返回true，否则返回false
     */
    async AddAccessedRepo(repo_url){
        let repo_list = await this.GetAccessedRepos();
        if(repo_list == null){
            repo_list = [];
        }
        let pre_num = repo_list.length;
        repo_list.push(repo_url);
        // 将repo_list转为set去重
        repo_list = Array.from(new Set(repo_list));
        await this._SetInfo('accessed_repo', repo_list);
        return pre_num != repo_list.length; 
    }
    /**
     * 直接设置访问过的仓库列表
     * @param {Array} repo_list
     * @returns 
     */
    async SetAccessedRepos(repo_list){
        return await this._SetInfo('accessed_repo', repo_list); 
    }
}

module.exports = ViewerDb;