// 仓库代码文件展示相关逻辑

function UpdateRepoFiles(repo_tree) {
    // 在repo-files中显示所有文件
    // 初始渲染
    gv.show_files = repo_tree.files;
    $(".sortable").removeClass("ascending descending");
    renderFiles(gv.show_files);
}

// 渲染文件列表
function renderFiles(files) {
    function _SetFileNodeEvent() {
        // click-node点击时切换active类存在状态
        _ToggleActive(".repo-file.click-node", function (actice_obj) {
            // 展示当前文件的全路径
            Info(_GetSelPath());
        });

        // 双击文件获取文件内容
        $(".repo-file.click-node").off("dblclick").on("dblclick", function () {
            $(this).addClass('active');
            var path = _GetSelPath();
            CallSys('get-repo-file', path);
        });
    }

    function _SetRepoFileMenu(){
        // 鼠标右键按下时模拟一次点击
        $("#repo-files .repo-file").mousedown(function(e){
            if(e.button == 2){
                if(!$(this).hasClass('active')){
                    $(this).click();
                }
            }
        });
    
        // 创建右键菜单
        var menu_items = {
            showlog: { name: "show log", callback: function(key, opt){
                setTimeout(function(){
                    CallSys('get-repo-log', _GetSelPath());
                }, 300);
            }},
            showproperties: { name: "show properties", callback: function(key, opt){
                setTimeout(function(){
                    CallSys('get-repo-properties', _GetSelPath());
                }, 300);
            }},
        };
        // 仅在本地缓存状态下增加open folder菜单
        if (gv.gv_local_cached){
            //console.log('add open folder menu item with flag: ' + gv.gv_local_cached);
            menu_items.openfolder = { name: "open folder", callback: function(key, opt){
                setTimeout(function(){
                    var path = _GetSelPath();
                    var folder_path = path.split('/').slice(0, -1).join('/');
                    CallSys('open-repo-folder', folder_path);
                }, 300);
            }};
        }
        // Destroy any existing context menu before creating a new one
        if ($.contextMenu) {
            $.contextMenu('destroy', "#repo-files .repo-file");
        }
        // Create the context menu with the current menu items
        $.contextMenu({
            // define which elements trigger this menu
            selector: "#repo-files .repo-file",
            // define the elements of the menu
            items: menu_items,
        });
    }

    let fileHtml = '';
    for (var i = 0; i < files.length; i++) {
        fileHtml += `<div class='repo-file click-node' tabindex='0'>
            <span class='file-name'>${files[i].text}</span>
            <span class='file-size'>${files[i].size}</span>
            <span class='file-revision'>${files[i].revision}</span>
            <span class='file-author'>${files[i].author}</span>
            <span class='file-date'>${files[i].date}</span>
            </div>`;
    }
    $('#repo-file-list').html(fileHtml);

    // 更新拷贝快捷键,需要延迟绑定
    setTimeout(function () {
        _SetFileNodeEvent();
        BindFilePathCopyHotKey(".repo-file");
        _SetRepoFileMenu();
    }, 500);
}

// 设置文件列表的视图的点击排序等事件
function SetFileHeadEvent() {
    // 点击列标题进行排序
    $(".sortable").off("click").on("click", function () {
        const sortKey = $(this).data("sort-key");
        const isAscending = ! $(this).hasClass("descending");
        
        // 排序文件
        gv.show_files.sort((a, b) => {
            if (a[sortKey] < b[sortKey]) return isAscending ? 1 : -1;
            if (a[sortKey] > b[sortKey]) return isAscending ? -1 : 1;
            return 0;
        });

        // 切换排序方向
        $(".sortable").removeClass("ascending descending");
        $(this).addClass(isAscending ? "descending" : "ascending");

        // 重新渲染文件列表
        renderFiles(gv.show_files);
    });
}