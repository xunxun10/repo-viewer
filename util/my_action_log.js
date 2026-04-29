const fs = require('fs');
const path = require('path');
const { MyDate } = require('./my_util');

class MyActionLog {
    static log_file_path = null;

    static Init(log_dir) {
        MyActionLog.log_file_path = path.join(log_dir, 'action.log');
        const dir = path.dirname(MyActionLog.log_file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    static Add(message, level = 'info') {
        const time = MyDate.Now();
        const line = `${time} [${level.toUpperCase()}] ${message}\n`;
        try {
            fs.appendFileSync(MyActionLog.log_file_path, line, 'utf-8');
        } catch (e) {
            console.error('Failed to write action log:', e.message);
        }
    }

    static GetLines(count = 50) {
        if (!MyActionLog.log_file_path || !fs.existsSync(MyActionLog.log_file_path)) {
            return [];
        }
        try {
            const content = fs.readFileSync(MyActionLog.log_file_path, 'utf-8');
            const lines = content.trim().split('\n').filter(l => l);
            const tail = lines.slice(-count);
            return tail.map(line => {
                const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.*)$/);
                if (match) {
                    return { create_time: match[1], level: match[2].toLowerCase(), message: match[3] };
                }
                return { create_time: '', level: 'info', message: line };
            });
        } catch (e) {
            console.error('Failed to read action log:', e.message);
            return [];
        }
    }
}

module.exports = MyActionLog;
