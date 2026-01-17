
// 将包含{revision, author, date, msg}的数组转换为html字符串
function ShowLogDialog(v){
    var html = `<div id='log-item-container'><table><thead><tr class='log-item log-item-head'>
    <th class='log-item-col log-item-revision'>Revision</th>
    <th class='log-item-col log-item-author'>Author</th>
    <th class='log-item-col log-item-date'>Date</th>
    <th class='log-item-col log-item-msg'>Message</th>
    </tr></thead>`
    html += '<tbody id="log-item-tbody">';
    html += _GenLogMegHtml(v);
    html += '</tbody></table></div>';
    gv.gv_log_data = v;
    // 显示修改的文件列表 v.files:[{path, action}]
    html += `<div id='log-file-container'></div><div id='log-msgs-container'></div><div id='log-operation'><button id='more-log-btn' class='btn btn-default'><span class=''>More</span></button></div>`;

    MyModal.Info(html, `${_GetSelPath()} commit log`);

    var _last_shift_click = null;
    // 设置点击事件，可按住shift+鼠标同时选中多条
    $("#log-item-tbody").on('mousedown', ".log-item-row", function(e){
        // 判断必须为鼠标左键
        if(e.button != 0){
            return;
        }
        var cur = $(this);
        if(e.shiftKey){
            // 先取消所有active状态
            $(".log-item-row").removeClass('active');
            // 将_last_shift_click和cur之间的元素选中
            var cur_index = cur.index();
            var last_index = _last_shift_click !== null ? _last_shift_click.index() : 0;
            var start = Math.min(cur_index, last_index);
            var end = Math.max(cur_index, last_index);

            // 遍历所有actice元素，将index存入数组
            var active_index = [];
            for(var i = start; i <= end; i++){
                $(".log-item-row").eq(i).addClass('active');
                active_index.push(i);
            }
            if(active_index.length > 0){
                var begin_ver = $(".log-item-row").eq(end).find('.log-item-revision').text();
                var end_ver = $(".log-item-row").eq(start).find('.log-item-revision').text();
                gv.gv_selected_log_version = [begin_ver, end_ver];
            }
            ShowLogMsg(active_index);
            ShowLogFiles(active_index);
            // console.log(`select indexs: ${active_index}`);  // debug console
        }else{
            // 单击事件
            $(".log-item-row").removeClass('active');
            $(this).addClass('active');
            var selected_log_vision = $(this).find('.log-item-revision').text();
            gv.gv_selected_log_version = [selected_log_vision, selected_log_vision];
            var active_index = [$(this).index()];
            ShowLogMsg(active_index);
            ShowLogFiles(active_index);
            // console.log(`select indexs: ${active_index}`);  // debug console

            _last_shift_click = cur;
        }
    });

    $("#more-log-btn").off('click').on('click', function(){
        // 获取当前最后一条日志的版本号
        var last_log_index = gv.gv_log_data.length - 1;
        var last_log_revision = gv.gv_log_data[last_log_index].revision;
        CallSys('get-more-repo-log', {path:_GetSelPath(), from_revision:last_log_revision});
    });

    // 默认点击第一行
    if(v.length > 0){
        $(".log-item-row").first().trigger({
            type: 'mousedown',
            button: 0 // 0 表示鼠标左键
        });
    }
}

/**
 * 追加日志信息到日志展示区域
 * @param {list} v 
 */
function AppendLogMsg(v){
    // 向#log-item-tbody追加日志信息
    if(!v || v.length == 0){
        Info("no more log data");
        // 将more-log-btn禁用
        $('#more-log-btn').prop('disabled', true);
        return;
    }
    var html = '';
    var exists_num = gv.gv_log_data.length;
    html += _GenLogMegHtml(v, exists_num);
    $('#log-item-tbody').append(html);
    // 更新gv.gv_log_data
    gv.gv_log_data.push(...v);
}

function _GenLogMegHtml(v, exists_num=0){
    var html = '';
    for(var i = 0; i < v.length; i++){
        html += `<tr class='log-item log-item-row' log-index='${i + exists_num}'>
        <td class='log-item-col log-item-revision'>${v[i].revision}</td>
        <td class='log-item-col log-item-author'>${v[i].author}</td>
        <td class='log-item-col log-item-date'>${v[i].date}</td>
        <td class='log-item-col log-item-msg'>${v[i].msg}</td>
        </tr>`;
    }
    return html;
}

// 展示所有提交日志
function ShowLogMsg(indexs){
    var html = 'MSG: ';
    for(var i = 0; i < indexs.length; i++){
        var cur_v = gv.gv_log_data[indexs[i]];
        html += `${cur_v.revision} | ${cur_v.author} | ${cur_v.msg.replace(/[;.；。]\s*$/g, '')}; `;
    }
    $('#log-msgs-container').text(html);
}

function ShowLogFiles(indexs){
    var html = '';
    // 聚合所有files信息
    var files = [];
    for(var i = 0; i < indexs.length; i++){
        var cur_v = gv.gv_log_data[indexs[i]];
        if (cur_v.files) {
            files.push(...cur_v.files);
        }
    }
    // 去重
    var files_key = {};
    files = files.filter((obj, index) => {
        const str = JSON.stringify(obj);
        var exists = files_key.hasOwnProperty(str);
        files_key[str] = true;
        return !exists;
    });

    // 不包含仓库根节点的路径信息
    var cur_path = _GetSelPath().replace(gv.gv_repo_head, '');
    //console.log('cur_path: ' + cur_path + "\nrepo_head:" + gv.gv_repo_head);   // TODO debug
    for(var i = 0; i < files.length; i++){
        // 跳过不包含当前路径的文件
        if(files[i].path.indexOf(cur_path) == -1){
            console.log(`skip file ${files[i].path} not in ${cur_path}`);  // debug console
            continue;
        }
        /*// 跳过kind为dir并且prop_mods为false并且没有copyfrom属性值的文件夹
        if(files[i].kind == 'dir' && files[i].prop_mods == 'false' && (!files[i].copy_from)){
            continue;
        }*/
        var copy_from_str = `<span class='log-file-from' title='copy from ${files[i].copy_from}'>${files[i].copy_from}</span>`;
        if(files[i].prop_mods == 'true'){
            var prop_mod = 'P';
            html += `<div class='log-file-item'><span class='log-file-action'>${files[i].action}</span><span class='log-prop-action' title="属性变更">${prop_mod}</span>|<span class='log-file-path'>${files[i].path}</span>${copy_from_str}</div>`;
        }
        // 对于文件夹，只对text_mode进行diff
        var no_diff_class = ""
        if(files[i].text_mods == 'false'){
            no_diff_class = 'not-diff';
        }
        html += `<div class='log-file-item ${no_diff_class}'><span class='log-file-action'>${files[i].action}</span><span class='log-prop-action' title="属性变更"></span>|<span class='log-file-path'>${files[i].path}</span>${copy_from_str}</div>`;
    }
    $('#log-file-container').html(html);
    // 双击文件获取文件变更内容
    $(".log-file-item").dblclick(function(){
        var path = $(this).find('.log-file-path').text();
        // 检查节点是否含有no-diff类，如果有则不进行diff
        if($(this).hasClass('not-diff')){
            Info(`skip show diff for dir ${path}`);
            return;
        }
        var action = $(this).find('.log-file-action').text();
        var prop_mod = $(this).find('.log-prop-action').text();
        // 范围为 [begin, end],前包后包
        var begin = null, end=null;
        if(action == 'M'){
            begin = gv.gv_selected_log_version[0];
            end = gv.gv_selected_log_version[1];
        }else if(action == 'A'){
            end = gv.gv_selected_log_version[1];
        }else if(action == 'D'){
            begin = gv.gv_selected_log_version[0];
        }
        if(prop_mod.length > 0){
            // 展示属性变更
            CallSys('get-repo-properties-diff', {path:gv.gv_repo_head+path, begin:begin, end:end});
        }else{
            // 展示文件内容
            CallSys('get-repo-file-diff', {path:gv.gv_repo_head+path, begin:begin, end:end});
        }
    });
    // log-file-item 点击时生成MSG信息
    $(".log-file-item").off('click').on('click', function(){
        // 将条目转换为文本，并在每个子div内容间添加空格
        var msg = '';
        msg += $(this).find('.log-file-action').text() + '   ';
        msg += $(this).find('.log-prop-action').text() + '   ';
        msg += $(this).find('.log-file-path').text() + '   ';
        msg += $(this).find('.log-file-from').text() + '   ';
        $('#log-msgs-container').html('<pre>CHG: ' + msg + '</pre>');
    });
}
