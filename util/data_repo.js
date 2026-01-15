import SqliteDB from './my_sldb.js';

class DataRepo{
    // 在数据库中创建表，包含key, value两个字段
    static async Init(db_file){
        this.db = new SqliteDB(db_file, "create table if not exists data_repo(key TEXT PRIMARY KEY, value TEXT);")
    }

    // 获取数据
    static async Get(key){
        let res = await this.db.Query('select * from data_repo where key = ?', [key]);
        if(res.length == 0){
            return null;
        }
        return res[0].value;
    }

    // 设置数据
    static async Set(key, value){
        let res = await this.db.Query('select * from data_repo where key = ?', [key]);
        if(res.length == 0){
            await this.db.Query('insert into data_repo(key, value) values(?, ?)', [key, value]);
        }else{
            await this.db.Query('update data_repo set value = ? where key = ?', [value, key]);
        }
    }

}

module.exports = DataRepo;