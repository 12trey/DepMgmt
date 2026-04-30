const WIN_TASKS = [
  {
    name: 'win_acl',
    desc: 'Set access control on a file or directory',
    snippet: `
    - name: Set ACL on path
      ansible.windows.win_acl:
        path: 'C:\\target\\path'
        user: 'DOMAIN\\Username'
        rights: FullControl
        type: allow
        state: present
`,
  },
  {
    name: 'win_command',
    desc: 'Run a command on a Windows host',
    snippet: `
    - name: Run command
      ansible.windows.win_command:
        cmd: whoami
      register: cmd_result
`,
  },
  {
    name: 'win_copy',
    desc: 'Copy a file to a Windows host',
    snippet: `
    - name: Copy file to host
      ansible.windows.win_copy:
        src: /local/path/file.txt
        dest: 'C:\\remote\\path\\file.txt'
`,
  },
  {
    name: 'win_credential',
    desc: 'Manage Windows Credential Manager entries',
    snippet: `
    - name: Add credential
      ansible.windows.win_credential:
        name: server_name
        type: domain_password
        username: 'DOMAIN\\user'
        secret: "{{ credential_password }}"
        state: present
`,
  },
  {
    name: 'win_environment',
    desc: 'Manage environment variables on Windows',
    snippet: `
    - name: Set environment variable
      ansible.windows.win_environment:
        name: MY_VAR
        value: my_value
        level: machine
        state: present
`,
  },
  {
    name: 'win_feature',
    desc: 'Install or remove Windows features',
    snippet: `
    - name: Install Windows feature
      ansible.windows.win_feature:
        name: Web-Server
        state: present
        include_management_tools: true
      register: feature_result
`,
  },
  {
    name: 'win_feature_info',
    desc: 'Get information about Windows features',
    snippet: `
    - name: Get feature info
      ansible.windows.win_feature_info:
        name: Web-Server
      register: feature_info
`,
  },
  {
    name: 'win_file',
    desc: 'Manage files and directories on Windows',
    snippet: `
    - name: Create directory
      ansible.windows.win_file:
        path: 'C:\\path\\to\\directory'
        state: directory
`,
  },
  {
    name: 'win_firewall',
    desc: 'Manage firewall rules on Windows',
    snippet: `
    - name: Add firewall rule
      ansible.windows.win_firewall_rule:
        name: My App Rule
        localport: 8080
        action: allow
        direction: in
        protocol: tcp
        state: present
        enabled: true
`,
  },
  {
    name: 'win_get_url',
    desc: 'Download a file from a URL to Windows',
    snippet: `
    - name: Download file
      ansible.windows.win_get_url:
        url: https://example.com/file.zip
        dest: 'C:\\temp\\file.zip'
`,
  },
  {
    name: 'win_group',
    desc: 'Manage local Windows groups',
    snippet: `
    - name: Create local group
      ansible.windows.win_group:
        name: MyGroup
        description: My local group
        state: present
`,
  },
  {
    name: 'win_group_membership',
    desc: 'Manage Windows local group membership',
    snippet: `
    - name: Add users to group
      ansible.windows.win_group_membership:
        name: Administrators
        members:
          - 'DOMAIN\\user1'
        state: present
`,
  },
  {
    name: 'win_package',
    desc: 'Install or uninstall a Windows package',
    snippet: `
    - name: Install package
      ansible.windows.win_package:
        path: 'C:\\installers\\setup.msi'
        state: present
        arguments: /quiet /norestart
`,
  },
  {
    name: 'win_path',
    desc: 'Manage the Windows PATH environment variable',
    snippet: `
    - name: Add path to PATH
      ansible.windows.win_path:
        elements:
          - 'C:\\new\\bin'
        state: present
`,
  },
  {
    name: 'win_powershell',
    desc: 'Run a PowerShell script on Windows',
    snippet: `
    - name: Run PowerShell script
      ansible.windows.win_powershell:
        script: |
          Write-Host "Hello from PowerShell"
          $result = "done"
          $result
      register: ps_result
`,
  },
  {
    name: 'win_reboot',
    desc: 'Reboot a Windows machine',
    snippet: `
    - name: Reboot host
      ansible.windows.win_reboot:
        reboot_timeout: 300
        msg: Rebooting for maintenance
`,
  },
  {
    name: 'win_reg_stat',
    desc: 'Get information about a Windows registry key',
    snippet: `
    - name: Get registry key info
      ansible.windows.win_reg_stat:
        path: 'HKLM:\\SOFTWARE\\MyApp'
      register: reg_info
`,
  },
  {
    name: 'win_regedit',
    desc: 'Manage Windows registry keys and values',
    snippet: `
    - name: Set registry value
      ansible.windows.win_regedit:
        path: 'HKLM:\\SOFTWARE\\MyApp'
        name: MyValue
        data: my_data
        type: string
        state: present
`,
  },
  {
    name: 'win_service',
    desc: 'Manage Windows services',
    snippet: `
    - name: Manage Windows service
      ansible.windows.win_service:
        name: MyService
        start_mode: auto
        state: started
`,
  },
  {
    name: 'win_shell',
    desc: 'Run a shell command on Windows',
    snippet: `
    - name: Run shell command
      ansible.windows.win_shell: |
        echo Hello World
      register: shell_result
`,
  },
  {
    name: 'win_user',
    desc: 'Manage local Windows user accounts',
    snippet: `
    - name: Manage local user
      ansible.windows.win_user:
        name: myuser
        password: "{{ user_password }}"
        state: present
        groups:
          - Users
`,
  },
];

module.exports = WIN_TASKS;
