const auth = {
  currentUser: null,

  init() {
    this.currentUser = window.api.getUser();
    this.setupListeners();
    this.updateUI();
  },

  setupListeners() {
    const loginUserForm = document.getElementById('loginUserForm');
    if (loginUserForm) {
      loginUserForm.addEventListener('submit', (e) => this.handlePortalLogin(e, 'usuario'));
    }

    const loginStaffForm = document.getElementById('loginStaffForm');
    if (loginStaffForm) {
      loginStaffForm.addEventListener('submit', (e) => this.handlePortalLogin(e, 'funcionario'));
    }

    const loginAdminForm = document.getElementById('loginAdminForm');
    if (loginAdminForm) {
      loginAdminForm.addEventListener('submit', (e) => this.handlePortalLogin(e, 'superadmin'));
    }

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout());
    }

    window.addEventListener('auth:expired', () => {
      this.currentUser = null;
      this.updateUI();
      window.showToast('Tu sesión ha expirado. Por favor ingresa nuevamente.', 'warning');
      this.openPortalLogin('usuario');
    });
  },

  openPortalLogin(portalRole) {
    const user = window.api.getUser();
    if (user) {
      window.showToast(`Ya tienes una sesión activa como ${user.nombre_completo}. Para ingresar con otra cuenta, primero debes cerrar la sesión actual.`, 'info');
      window.router.navigateToRoleDefault(user.rol_nombre || user.rol);
      return;
    }

    window.hideModal('loginUserModal');
    window.hideModal('loginStaffModal');
    window.hideModal('loginAdminModal');

    if (portalRole === 'superadmin') {
      window.showModal('loginAdminModal');
    } else if (portalRole === 'funcionario') {
      window.showModal('loginStaffModal');
    } else {
      window.showModal('loginUserModal');
    }
  },

  async handlePortalLogin(e, portal) {
    e.preventDefault();

    let identificador = '';
    let password = '';
    let modalId = 'loginUserModal';

    if (portal === 'superadmin') {
      identificador = document.getElementById('loginAdminDoc')?.value.trim();
      password = document.getElementById('loginAdminPass')?.value.trim();
      modalId = 'loginAdminModal';
    } else if (portal === 'funcionario') {
      identificador = document.getElementById('loginStaffDoc')?.value.trim();
      password = document.getElementById('loginStaffPass')?.value.trim();
      modalId = 'loginStaffModal';
    } else {
      identificador = document.getElementById('loginUserDoc')?.value.trim();
      password = document.getElementById('loginUserPass')?.value.trim();
      modalId = 'loginUserModal';
    }

    if (!identificador || !password) {
      window.showToast('Por favor completa todos los campos.', 'warning');
      return;
    }

    const res = await window.api.post('/auth/login', {
      identificador,
      password,
      portal
    });

    if (res.success) {
      window.api.setToken(res.token);
      window.api.setUser(res.user);
      this.currentUser = res.user;

      // Limpiar campos del formulario
      const form = e.target;
      if (form) form.reset();

      window.hideModal(modalId);
      window.showToast(`¡Bienvenido(a), ${res.user.nombre_completo}!`, 'success');
      this.updateUI();

      if (window.socketService) {
        window.socketService.joinUserRoom(res.user.id);
        if (res.user.rol_nombre === 'funcionario' || res.user.rol_nombre === 'superadmin') {
          window.socketService.joinStaffRoom();
        }
      }

      window.router.navigateToRoleDefault(res.user.rol_nombre || res.user.rol);
    } else {
      window.showToast(res.message || 'Error al iniciar sesión.', 'error');
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const nombre_completo = document.getElementById('regNombre').value.trim();
    const documento = document.getElementById('regDocumento').value.trim();
    const correo = document.getElementById('regCorreo').value.trim();
    const password = document.getElementById('regPassword').value.trim();

    if (!nombre_completo || !documento || !correo || !password) {
      window.showToast('Por favor llena todos los campos.', 'warning');
      return;
    }

    const res = await window.api.post('/auth/register', {
      nombre_completo,
      documento,
      correo,
      password
    });

    if (res.success) {
      window.api.setToken(res.token);
      window.api.setUser(res.user);
      this.currentUser = res.user;

      const form = e.target;
      if (form) form.reset();

      window.hideModal('registerModal');
      window.showToast('Cuenta creada con éxito. Bienvenido(a).', 'success');
      this.updateUI();

      if (window.socketService) {
        window.socketService.joinUserRoom(res.user.id);
      }

      window.router.navigate('userView');
    } else {
      window.showToast(res.message || 'Error al crear la cuenta.', 'error');
    }
  },

  logout() {
    window.api.clearSession();
    this.currentUser = null;
    this.updateUI();
    window.showToast('Sesión cerrada correctamente.', 'info');
    window.router.navigate('publicView');
  },

  updateUI() {
    this.currentUser = window.api.getUser();
    const user = this.currentUser;
    const authActions = document.getElementById('authActions');
    const userProfileMenu = document.getElementById('userProfileMenu');
    const navUserName = document.getElementById('navUserName');
    const navUserRole = document.getElementById('navUserRole');
    const publicPortalsSection = document.getElementById('publicPortalsSection');
    const publicLoggedInBanner = document.getElementById('publicLoggedInBanner');
    const publicLoggedInUserName = document.getElementById('publicLoggedInUserName');
    const publicLoggedInUserRole = document.getElementById('publicLoggedInUserRole');
    const publicGoToPanelBtn = document.getElementById('publicGoToPanelBtn');

    if (user) {
      const rol = (user.rol_nombre || user.rol || '').toLowerCase();

      // 1. Ocultar botones de acceso del header
      if (authActions) authActions.style.display = 'none';

      // 2. Mostrar datos del perfil activo en el header
      if (userProfileMenu) userProfileMenu.style.display = 'flex';
      if (navUserName) navUserName.textContent = user.nombre_completo;
      if (navUserRole) {
        navUserRole.textContent = rol.toUpperCase();
        if (rol === 'superadmin') {
          navUserRole.className = 'status-badge proximo_terminar';
        } else if (rol === 'funcionario') {
          navUserRole.className = 'status-badge warning';
        } else {
          navUserRole.className = 'status-badge disponible';
        }
      }

      // 3. Quitar / ocultar los portales de ingreso en la pantalla pública
      if (publicPortalsSection) {
        publicPortalsSection.style.display = 'none';
      }

      // 4. Mostrar el banner informativo de sesión activa
      if (publicLoggedInBanner) {
        publicLoggedInBanner.style.display = 'block';
        if (publicLoggedInUserName) publicLoggedInUserName.textContent = user.nombre_completo;
        if (publicLoggedInUserRole) {
          publicLoggedInUserRole.textContent = rol.toUpperCase();
          publicLoggedInUserRole.className = `status-badge ${rol === 'superadmin' ? 'proximo_terminar' : rol === 'funcionario' ? 'warning' : 'disponible'}`;
        }
        if (publicGoToPanelBtn) {
          publicGoToPanelBtn.onclick = () => window.router.navigateToRoleDefault(rol);
        }
      }
    } else {
      // Sin sesión activa: volver a mostrar portales e ingresos
      if (authActions) authActions.style.display = 'flex';
      if (userProfileMenu) userProfileMenu.style.display = 'none';
      if (publicPortalsSection) publicPortalsSection.style.display = 'block';
      if (publicLoggedInBanner) publicLoggedInBanner.style.display = 'none';
    }

    this.renderNavLinks();
  },

  renderNavLinks() {
    const user = this.currentUser || window.api.getUser();
    const navLinks = document.getElementById('navLinks');
    if (!navLinks) return;

    let linksHtml = `
      <button class="btn btn-secondary btn-sm" onclick="window.router.navigate('publicView')">
        <i class="fas fa-desktop"></i> Sala en Vivo
      </button>
    `;

    const rol = user ? (user.rol_nombre || user.rol) : null;
    if (rol) {
      if (rol === 'usuario') {
        linksHtml += `
          <button class="btn btn-primary btn-sm" onclick="window.router.navigate('userView')">
            <i class="fas fa-user-clock"></i> Mi Panel
          </button>
        `;
      } else if (rol === 'funcionario') {
        linksHtml += `
          <button class="btn btn-warning btn-sm" onclick="window.router.navigate('staffView')">
            <i class="fas fa-tasks"></i> Control de Sala
          </button>
        `;
      } else if (rol === 'superadmin') {
        linksHtml += `
          <button class="btn btn-primary btn-sm" onclick="window.router.navigate('adminView')" style="background: linear-gradient(135deg, #8b5cf6, #6366f1); border-color: #8b5cf6;">
            <i class="fas fa-shield-alt"></i> Panel Super Admin
          </button>
          <button class="btn btn-warning btn-sm" onclick="window.router.navigate('staffView')">
            <i class="fas fa-tasks"></i> Control Sala
          </button>
        `;
      }
    }

    navLinks.innerHTML = linksHtml;
  }
};

window.auth = auth;
