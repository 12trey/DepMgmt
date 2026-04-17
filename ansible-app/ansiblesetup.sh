#!/bin/bash

# --- Configuration Variables ---
# Set the desired timezone for configuration files
TIMEZONE="America/New_York"
# Define the Kerberos Realm and KDC details
KERB_REALM="CORP.AD.SENTARA.COM"
KDC_SERVER="corpadsen01-ind.corp.ad.sentara.com"
PYTHON_VENV_DIR="/opt/.ansiblevenv"
NVM_VERSION="v24.14.1"

# --- Helper Functions ---

# Function to check if a package is installed
is_installed() {
    dpkg -l | grep -q "^ii  $1"
}

# Function to check if a command is available
command_available() {
    command -v "$1" >/dev/null 2>&1
}

# Function to install packages
install_packages() {
    echo "--> Installing system dependencies..."
    local packages="$1"
    # Check if all packages are already installed first
    local missing_packages=""
    for pkg in $packages; do
        if ! is_installed "$pkg"; then
            missing_packages+="$pkg "
        fi
    done

    if [ -z "$missing_packages" ]; then
        echo "    [INFO] All core system dependencies are already installed."
    else
        echo "    [INFO] Updating and installing missing packages: $missing_packages"
        sudo apt update
        sudo DEBIAN_FRONTEND=noninteractive apt install -y $missing_packages
        echo "    [SUCCESS] System dependencies installed or confirmed."
    fi
}

# --- Main Setup Function ---

setup_environment() {
    echo "=================================================="
    echo "  WSL Environment Setup Script: Setting up Development Tools"
    echo "=================================================="

	#export DEBIAN_FRONTEND=noninteractive
	
    # 1. SYSTEM DEPENDENCIES INSTALLATION
    # List of critical system packages required for Python, Kerberos, and utilities.
    SYSTEM_DEPS="krb5-user python3 python3-pip python3-venv gcc python3-dev libkrb5-dev curl wget sudo jq"

    install_packages "$SYSTEM_DEPS"

    # 2. KERBEROS CONFIGURATION (Timezone and krb5.conf)
    echo "--> Configuring Timezone and Kerberos Files..."

    # Set timezone
    if [ -f /etc/timezone ]; then
        echo "    [INFO] Setting timezone to $TIMEZONE..."
        sudo sh -c "echo $TIMEZONE > /etc/timezone"
    else
        echo "    [WARN] Could not find /etc/timezone, skipping timezone setup."
    fi

    # Set krb5.conf
    KRB5_CONF_CONTENT=$(cat <<EOF
[libdefaults]
        default_realm = ${KERB_REALM}

# The following krb5.conf variables are only for MIT Kerberos.
        kdc_timesync = 1
        ccache_type = 4
        forwardable = true
        proxiable = true
        rdns = false


# The following libdefaults parameters are only for Heimdal Kerberos.
        fcc-mit-ticketflags = true

[realms]
        ${KERB_REALM} = {
                kdc = ${KDC_SERVER}
                admin_server = ${KDC_SERVER}
                default_domain = corp.ad.sentara.com
        }

[domain_realm]
        .corp.ad.sentara.com = ${KERB_REALM}
        corp.ad.sentara.com = ${KERB_REALM}
EOF
)
    if ! grep -q "default_realm = ${KERB_REALM}" /etc/krb5.conf; then
        echo "    [INFO] Configuring /etc/krb5.conf..."
        echo "$KRB5_CONF_CONTENT" | sudo tee /etc/krb5.conf > /dev/null
    else
        echo "    [INFO] /etc/krb5.conf appears correctly configured. Skipping write."
    fi


    # 3. DESKTOP / GRAPHICAL DEPENDENCIES (Optional: Uncomment if needed)
    echo "--> Installing GUI/Desktop Components (XFCE/VNC) (Optional)..."
    # Note: These are large packages and might require more time/disk space.
    GUI_DEPS="xfce4 xfce4-goodies tightvncserver novnc"
    if install_packages "$GUI_DEPS"; then
        echo "    [SUCCESS] GUI components installed (or confirmed)."
    fi


    # 4. PYTHON ENVIRONMENT SETUP (Ansible, pywinrm)
    echo "--> Setting up Python Virtual Environment and Libraries..."
    
    # Check if virtual environment exists
    if [ ! -d "$PYTHON_VENV_DIR" ]; then
        echo "    [INFO] Creating Python virtual environment: $PYTHON_VENV_DIR"
        python3 -m venv "$PYTHON_VENV_DIR"
		chmod -R 755 "$PYTHON_VENV_DIR"
    fi

    # Source the virtual environment activation script
    VENV_BIN="$PYTHON_VENV_DIR/bin"
    if [ -f "$VENV_BIN/pip3" ]; then
        export PATH="$VENV_BIN:$PATH"
        echo "    [INFO] Using virtual environment: $VENV_BIN"
		cat >> /etc/bash.bashrc <<EOF
source "$VENV_BIN/activate"
EOF
    else
        echo "    [ERROR] Virtual environment setup failed. Cannot proceed with Python installs."
        exit 1
    fi

    # Install Python packages
    echo "    [INFO] Installing core Python packages (ansible-core, pywinrm[kerberos], websockify)..."
    
    # Check if ansible-core is already installed
    if ! pip3 show ansible-core > /dev/null 2>&1; then
        pip3 install ansible-core
    else
        echo "    [INFO] ansible-core already installed."
    fi

    # Check and install pywinrm[kerberos]
    if ! pip3 show pywinrm > /dev/null 2>&1; then
        echo "    [INFO] Installing pywinrm[kerberos]..."
        pip3 install pywinrm[kerberos]
    else
        echo "    [INFO] pywinrm already installed."
    fi
    
    # websockify is often needed by winrm components
    if ! pip3 show websockify > /dev/null 2>&1; then
        echo "    [INFO] Installing websockify..."
        pip3 install websockify
    else
        echo "    [INFO] websockify already installed."
    fi

    # Install Ansible Collections
    echo "    [INFO] Installing Ansible Collections (ansible.windows, ansible.posix)..."
    pip3 install ansible-galaxy

    ansible-galaxy collection install ansible.windows --ignore-certs
    ansible-galaxy collection install ansible.posix --ignore-certs
    echo "    [SUCCESS] Python libraries and collections successfully installed."


    # 5. NODEJS/NVM SETUP
    echo "--> Installing Node Version Manager (NVM)..."
    
    if ! command_available nvm; then
        if [ -d "$HOME/.nvm" ]; then
             echo "    [INFO] NVM directory found, but NVM command not available. Skipping NVM install."
        else
             echo "    [INFO] Downloading and running NVM installation script..."
             curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
             
             # Source nvm to make it available in the current shell session
             export NVM_DIR="$HOME/.nvm"
             [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
             [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
        fi
        
        # Install specific Node version
        if command -v nvm &> /dev/null; then
             echo "    [INFO] Installing Node.js version $NVM_VERSION..."
             nvm install $NVM_VERSION
             nvm use $NVM_VERSION
        else
             echo "    [ERROR] NVM could not be activated or found. Skipping Node installation."
        fi
    else
        echo "    [INFO] NVM is already available."
    fi


    # 6. CLEANUP AND WRAPUP
    echo "=================================================="
    echo "✅ Environment Setup Complete!"
    echo "=================================================="
    echo "A virtual environment has been created in './$PYTHON_VENV_DIR'."
    echo "To use the installed Python tools (Ansible, etc.), please activate it:"
    echo "    source $PYTHON_VENV_DIR/bin/activate"
    echo ""
    echo "The system packages are installed and configured for use."
}

# Execute the main function
setup_environment

