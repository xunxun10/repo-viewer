
function OpenPasswordPanel(data){
    // 生成包含主机、用户名及密码输入框的html代码
    var html = `<table class='passwrod-table settings-table'>
    <tr>
        <td>Host:</td>
        <td><input type='text' id='host-input' class='modal-input' value="${data.host || ''}" ${data.host ? "readonly" : ""} title="主机名:端口，凭据将绑定到该主机"></td>
    </tr>
    <tr>
        <td>Username:</td>
        <td><input type='text' id='user-input' class='modal-input' value="${data.user || ''}"></td>
    </tr>
    <tr>
        <td>Password:</td>
        <td><input type='password' id='password-input' class='modal-input' value="${data.hasPwd ? '********' : ''}"></td>
    </tr>
    <tr>
        <td colspan='2' style='font-size:12px;color:#888;padding-top:2px;'>提示：用户名与密码均可留空，留空即按匿名方式访问该仓库（仅适用于无需认证仓库）。</td>
    </tr>
    </table>`
    function Ok(){
        var pwd = $('#password-input').val();
        // 如果密码输入框内容仍是占位符，则不更新密码
        var v = { host: ($('#host-input').val() || '').trim(), user: $('#user-input').val(), password: (pwd === '********' ? undefined : pwd) };
        CallSys('set-password', v);
    }
    MyModal.Confirm(html, Ok, null, null, "请输入该仓库主机(SVN/Git)的访问用户及密码");
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