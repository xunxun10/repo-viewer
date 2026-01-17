
/**
 * jstree不显示文字前的图标，并增加一个根节点
 * @param {Object} repo
 **/
function _CreateRepoTreeNode(repo){
    return {
        'core' : {
            'data' : repo.tree.dirs,
            'themes' : {
                'icons' : false,
                'dots' : true,
            },
            'dblclick_toggle' : false, // 双击不展开
            'check_callback' : true,  // 允许修改节点
            'multiple': false,  // 不允许多选
        },
        'plugins': ['contextmenu'],
        'contextmenu': {
            'items': function (node) {
                return {
                    // 自定义菜单项
                    "showlog": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "show log",
                        "action": function (obj) {
                            // 菜单点击逻辑，obj.reference（节点的 DOM 元素），也可以直接使用node变量
                            $('.repo-file.click-node').removeClass('active');
                            SetSelectNode(node)
                            CallSys('get-repo-log', _GetSelPath());
                        }
                    },
                    // 添加刷新菜单
                    "refresh": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "refresh",
                        "action": function (obj) {
                            CallSys("refresh-repo", gv.gv_repo_url);
                            // 菜单点击逻辑，obj.reference（节点的 DOM 元素），也可以直接使用node变量
                            _RefreshNodeChildren(node);
                        }
                    },
                    "showproperties": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "show properties",
                        "action": function (obj) {
                            // 菜单点击逻辑，obj.reference（节点的 DOM 元素），也可以直接使用node变量
                            $('.repo-file.click-node').removeClass('active');
                            SetSelectNode(node)
                            CallSys('get-repo-properties', _GetSelPath());
                        }
                    },
                    // 收缩父节点
                    "collapse parent": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "collapse parent",
                        "action": function (obj) {
                            var parent_node = $('#repo-tree').jstree('get_node', node.parent);
                            // 选中并关闭父节点
                            $('#repo-tree').jstree('select_node', parent_node, true);
                            $('#'+node.parent + '>.jstree-anchor').click();
                            $('#repo-tree').jstree('close_node', parent_node);
                        }
                    },
                    // 每次展开都会刷新子节点信息，因此不需要刷新菜单
                    // 其他菜单项...
                };
            }
        }
    }
}


function ShowpropertiesDialog(v){
    var html = `<div id='properties-item-container'><table><thead><tr class='properties-item properties-item-head'>
    <th class='properties-item-col properties-item-key'>Key</th>
    <th class='properties-item-col properties-item-value'>Value</th>
    </tr></thead>`
    html += '<tbody>';
    // 遍历v的keys，生成html
    for(var key in v){
        html += `<tr class='properties-item properties-item-row'>
        <td class='properties-item-col properties-item-key'>${key}</td>
        <td class='properties-item-col properties-item-value'><pre>${v[key]}</pre></td>
        </tr>`;
    }
    html += '</tbody></table></div>';
    MyModal.Info(html, `${_GetSelPath()} properties`);
}

function SetSelectNode(node){
    // 记录下点击的节点
    gv.gv_select_node = node;
    gv.gv_select_node_id = "#" + node.id;
}
function ClearSelectNode(){
    gv.gv_select_node = null;
    gv.gv_select_node_id = null;
}
// 返回当前节点或文件的全路径,包括 repo_url root + file_path
function _GetSelPath(node = null){
    if(node){
        var cur_node = node;
    }else{
        var cur_node = gv.gv_select_node;
    }
    var path = "";
    if(cur_node){
        path = cur_node.text + '/';
        while(cur_node.parent && cur_node.parent != '#'){
            cur_node = $('#repo-tree').jstree('get_node', "#" + cur_node.parent);
            path = cur_node.text + '/' + path;
        }
    }
    // 如果有选择文件需要加上文件路径
    var select_file_node = $('.repo-file.click-node.active');
    if(select_file_node.length > 0){
        path += $('.file-name', select_file_node).text();
    }
    // 如果gv.gv_repo_url末尾有'/'，则去掉
    if(gv.gv_repo_url.slice(-1) == '/'){
        gv.gv_repo_url = gv.gv_repo_url.slice(0, -1);
    }
    if(path != ''){
        path = gv.gv_repo_url + '/' + path;
    }else{
        path = gv.gv_repo_url;
    }
    // 去除路径末尾的'/'
    if(path.slice(-1) == '/'){
        path = path.slice(0, -1);
    }
    return path;
}

// 根据url获取分支名，分支名为branches或者tags下的文件夹名或者master或者trunk
function _GetBrName(repo_file_url){
    // 分解URL路径部分
    var parts = repo_file_url.split('/');
    
    // 查找branches或tags的位置
    var branchesIndex = parts.indexOf('branches');
    var tagsIndex = parts.indexOf('tags');
    
    // 如果找到branches
    if(branchesIndex !== -1 && branchesIndex + 1 < parts.length) {
        return parts[branchesIndex + 1];
    }
    
    // 如果找到tags
    if(tagsIndex !== -1 && tagsIndex + 1 < parts.length) {
        return parts[tagsIndex + 1];
    }
    
    // 检查是否有trunk
    if(parts.includes('trunk')) {
        return 'trunk';
    }
    
    return 'master'; // 默认分支名
}

// 如果当前repo使用缓存，并且当前选中节点与前一节点分支名不同，则强制刷新，避免切换分支后异常
function _NeedRefresh(pre_node, new_node){
    //gv.gv_select_node
    if(gv.gv_local_cached && pre_node){
        var pre_url = _GetSelPath(pre_node);
        var new_url = _GetSelPath(new_node);
        
        var cur_branch = _GetBrName(pre_url);
        var new_branch = _GetBrName(new_url);

        return cur_branch != new_branch;
    }
}

function _AddRepoTreeEvent(tree_jq_obj){
    tree_jq_obj.on("ready.jstree", function () {
        // 设置点击文字时触发点击事件
        tree_jq_obj.on("click.jstree", ".jstree-anchor", function (e) {
            var node = $('#repo-tree').jstree('get_node', $(this).closest('.jstree-node'));  // 获取包含该文字的JSON数据
            // 处理 "more" 节点点击：加载更多子节点
            if(node && node.id && node.id.indexOf('_more_') !== -1){
                _HandleMoreNode(node);
                return;
            }
            var pre_node = gv.gv_select_node;
            // 展开子节点
            SetSelectNode(node);
            // 只在关闭状态下获取新数据并触发展开
            if(!node.state.opened){
                $('#repo-tree').jstree('toggle_node', node);
            }else{
                if (_NeedRefresh(pre_node, node)){
                    // 如果当前节点已展开，并且已有子节点则刷新子节点
                    _RefreshNodeChildren(node);
                }
            }
            // 点击时更新files信息
            if(gv.gv_tree_cache[node.id]){
                UpdateRepoFiles(gv.gv_tree_cache[node.id].tree);
            }
            // 清除文件选择
            $('.repo-file.click-node').removeClass('active');
            // 展示当前选择路径
            Info(_GetSelPath());
        });

        // 展开时获取子节点
        $('#repo-tree').on('before_open.jstree', function (e, data) {
            var node = data.node;
            _RefreshNodeChildren(node);
        });

        // 添加右键菜单
        tree_jq_obj.on("contextmenu.jstree", function (e, data) {
            var node = $('#repo-tree').jstree('get_node', e.target);
            SetSelectNode(node);
            $('#repo-tree').jstree('select_node', node);
            $('#repo-tree').jstree('show_contextmenu', node);
        });

        /** 设置选择事件
        $('#repo-tree').on("select_node.jstree", function (e, data) {
            gv.gv_select_node = data.node;
        }); */
    });
}

// 调用后台数据刷新节点的子节点信息
function _RefreshNodeChildren(node){
    SetSelectNode(node);
    // 设置节点选中，但不触发选中事件
    $('#repo-tree').jstree('select_node', node, true);

    // console.log("open node:" + JSON.stringify(node))  # debug console
    // 遍历节点的所有父节点，拼接路径
    var cur_node = node;
    var path = cur_node.text;
    while(cur_node.parent && cur_node.parent != '#'){
        cur_node = $('#repo-tree').jstree('get_node', "#" + cur_node.parent);
        path = cur_node.text + '/' + path;
    }
    CallSys('get-repo-node', gv.gv_repo_url + '/' + path);
}


/**
 * 更新仓库树节点，如果有选中节点则只更新该节点下的子节点，否则更新整个树
 * @param {*} repo repo.tree结构：{base: 'xxx', path='xxx', dirs: [{text: 'xxx'}], , files: [{text: 'xxx'}]}
 */
function UpdateRepoTree(repo){
    // js tree data 需要的结构：[{text: 'xxx', children: [{text: 'xxx'}]}]
    if (gv.gv_select_node){
        //console.log('update repo tree: ' + gv.gv_select_node_id);  // debug console
        selected_node_id = gv.gv_select_node_id;

        // 如果有选中的节点，则清除原节点下的子节点数据并将数据追加到节点下

        // 清除所有子节点
        var children =  $('#repo-tree').jstree(true).get_node(selected_node_id).children;
        //console.log('delete node '+selected_node_id+':' + JSON.stringify(children));
        $('#repo-tree').jstree(true).delete_node(children);

        // 添加新的子节点，目前不支持通过数组方式一次添加多个节点
        /*if(repo.tree.dirs.length > 0){
            console.log('new node to '+selected_node_id+':' + JSON.stringify(repo.tree.dirs));  // debug console
            $(selected_node_id).jstree(true).create_node(selected_node_id, repo.tree.dirs, 'last', function (e) { true; }, true);
        }*/
        if(repo.tree.dirs.length > 0){
            const batch = DEFAULT_MAX_NODE;
            // 当子节点超过 batch 个时，只展示按照子节点 date 数据排序的最后 batch 个节点，并提供 "more" 节点用于加载更多
            if(repo.tree.dirs.length > batch){
                console.log(`too many nodes, only show last ${batch} nodes initially, add 'more' to show more`)
                Info(`too many nodes, only show last ${batch} nodes initially, add 'more' to show more`);

                // 按照子节点 date 数据排序（降序，最新在前），并将前 batch 个作为当前展示，其余缓存起来
                var sorted_dirs = repo.tree.dirs.slice().sort(function(a, b){
                    var at = new Date(a.date).getTime() || 0;
                    var bt = new Date(b.date).getTime() || 0;
                    return bt - at; // 降序
                });
                var show_dirs = sorted_dirs.slice(0, batch);
                var remaining = sorted_dirs.slice(batch);

                // 缓存剩余节点到 gv.gv_tree_more，key 为父节点的 id（不带 #）
                if(!gv.gv_tree_more) gv.gv_tree_more = {};
                // selected_node_id 形如 '#nodeid'
                const parentKey = selected_node_id.slice(1);
                gv.gv_tree_more[parentKey] = remaining;
            }else{
                var show_dirs = repo.tree.dirs;
            }
            for (var i = 0; i < show_dirs.length; i++) {
                $(selected_node_id).jstree(true).create_node(selected_node_id, show_dirs[i], 'last', function (e) { true; }, true);
            }
            // 如果存在缓存的更多节点，则添加一个 more 节点
            const cacheKey = selected_node_id.slice(1);
            if(gv.gv_tree_more && gv.gv_tree_more[cacheKey] && gv.gv_tree_more[cacheKey].length > 0){
                const moreId = cacheKey + '_more_' + Date.now();
                $(selected_node_id).jstree(true).create_node(selected_node_id, { id: moreId, text: `...more (${gv.gv_tree_more[cacheKey].length})...`, children: [] }, 'last', function (e) { true; }, true);
            }
        }

        _AddRepoTreeEvent($(selected_node_id));
    }else{
        console.log('update whole repo tree: #');  // debug console
        // 销毁原树并创建新树
        $('#repo-tree').jstree('destroy');
        $('#repo-tree').jstree(_CreateRepoTreeNode(repo));
        _AddRepoTreeEvent($('#repo-tree'));
    }
}

// 默认每次显示的最多子节点数
const DEFAULT_MAX_NODE = 100;

/**
 * 处理 more 节点：从缓存中取出下一批节点并追加到父节点下
 * @param {*} moreNode 
 * @returns 
 */
function _HandleMoreNode(moreNode){
    try{
        const tree = $('#repo-tree').jstree(true);
        const parentId = moreNode.parent; // jstree node id (no '#')
        const key = parentId; // 存储使用不带#的id
        const remaining = gv.gv_tree_more && gv.gv_tree_more[key] ? gv.gv_tree_more[key] : [];
        if(!remaining || remaining.length === 0){
            // 没有更多数据，移除more节点
            tree.delete_node(moreNode.id);
            return;
        }

        const batchSize = DEFAULT_MAX_NODE;
        // 取出下一批（remaining 按降序保存：从最近的旧项到最旧），从前端取出 nextBatch
        const takeCount = Math.min(batchSize, remaining.length);
        const nextBatch = remaining.splice(0, takeCount);
        // 保持按日期降序的顺序（remaining 已是降序），无需按 text 重排

        // 删除当前的 more 节点
        tree.delete_node(moreNode.id);

        // 追加节点
        nextBatch.forEach(function(n){
            tree.create_node(parentId, n, 'last', function () { true; }, true);
        });

        // 如果还有剩余，则再添加一个新的 more 节点
        if(remaining.length > 0){
            const moreId = parentId + '_more_' + Date.now();
            tree.create_node(parentId, { id: moreId, text: `...more (${remaining.length})...`, children: [] }, 'last', function () { true; }, true);
            // 更新缓存
            if(!gv.gv_tree_more) gv.gv_tree_more = {};
            gv.gv_tree_more[key] = remaining;
        } else {
            // 清空缓存
            if(gv.gv_tree_more) delete gv.gv_tree_more[key];
        }
    }catch(e){
        console.error('handle more node error: ' + e.message);
    }
}

/**
 * 获取节点 json对象
 * @param {*} node_id 不含有#的节点id
 * @returns 
 */
function GetTreeNodeById(node_id){
    if(!node_id) return null;
    return $('#repo-tree').jstree('get_node', "#" + node_id);
}
/**
 * 从指定父节点下获取指定子节点文字对应的节点json对象
 * @param {*} child_text_name 
 * @param {*} parent_node_id 
 * @returns 
 */
function GetTreeChildNode(child_text_name, parent_node_id=null){
    const tree = $('#repo-tree').jstree(true);
    if(!tree) return null;
    parent_node_id = parent_node_id ? parent_node_id : '#';
    // children为子节点id数组
    const children = tree.get_node(parent_node_id).children;
    for(let i = 0; i < children.length; i++){
        const child = tree.get_node(children[i]);
        if(child.text === child_text_name){
            return child;
        }
    }
    return null;
}
/**
 * 触发节点点击事件
 * @param {*} node_id 不含有#的节点id
 * @returns 
 */
function TriggerTreeNodeClick(node_id){
    const node = GetTreeNodeById(node_id);
    if(!node) return;
    // 触发节点click事件
    $('#' + node.id + " .jstree-anchor").trigger('click');
}