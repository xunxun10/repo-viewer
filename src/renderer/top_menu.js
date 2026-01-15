
function OpenPasswordPanel(user){
    // 生成包含用户名及密码输入框的html代码
    var html = `<table class='passwrod-table settings-table'>
    <tr>
        <td>Username:</td>
        <td><input type='text' id='user-input' class='modal-input' value="${user}"></td>
    </tr>
    <tr>
        <td>Password:</td>
        <td><input type='password' id='password-input' class='modal-input'></td>
    </tr>
    </table>`
    function Ok(){
        var v = { user: $('#user-input').val(), password: $('#password-input').val() };
        CallSys('set-password', v);
    }
    MyModal.Confirm(html, Ok, null, null, "请输入SVN仓库访问用户及密码");
}

/**
 * 
 * @param {*} settings 为包含多条{name, value, desc}对象的数组
 */
function OpenSettingsPanel(settings){
    // 生成包含设置项的html代码
    var html = `<table class='settings-table'>`;
    settings.forEach(setting => {
        const escapedValue = String(setting.value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const escapedHelp = String(setting.help).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        html += `<tr>
                    <td>${setting.desc}:</td>
                    <td><input type='text' class='modal-input settings-value' id='settings-${setting.name}' value="${escapedValue}" title="${escapedHelp}"></td>
                </tr>`;
    });
    html += `</table>`;

    function Ok(){
        var values = {};
        settings.forEach(setting => {
            values[setting.name] = $(`#settings-${setting.name}`).val();
        });
        CallSys('set-settings', values);
    }

    MyModal.Confirm(html, Ok, null, null, "修改设置");
}