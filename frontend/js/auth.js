/**
 * BIBLIOTIEMPODOCE - MÓDULO DE AUTENTICACIÓN Y ROLES
 * Accesos diferenciados por portal (Usuario, Funcionario, Super Admin)
 */

const auth = {
  currentUser: null,

  init() {
    this.currentUser = window.api.getUser();
    this.setupListeners();
    this.updateUI();
  },

  setupListeners() {
    // 1. Formulario de Ingreso: Portal Usuario
    const loginUserForm = document.getElementById('loginUserForm');
    if (loginUserForm) {
      loginUserForm.addEventListener('submit', (e) => this.handlePortalLogin(e, 'usuario'));
    }

    // 2. Formulario de Ingreso: Portal Funcionario
    const loginStaffForm = document.getElementById('loginStaffForm');
    if (loginStaffForm) {
      loginStaffForm.addEventListener('submit', (e) => this.handlePortalLogin(e, 'funcionario'));
    }

    // 3. Formulario de Ingreso: Portal Super Admin
    const loginAdminForm = document.getElementById('loginAdminForm');
    if (loginAdminForm) {
      loginAdminForm.addEventListener('submit', (e) => this.handlePortalLogin(e, 'superadmin'));
    }

    // Formulario de Registro
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    }

    // Botón de Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout());
    }

    // Escucha de sesión expirada
    window.addEventListener('auth:expired', () => {
      this.currentUser = null;
      this.updateUI();
      window.showToast('Tu sesión ha expirado. Por favor ingresa nuevamente.', 'warning');
      this.openPortalLogin('usuario');
    });
  },

  /**
   * Abre el modal de ingreso correspondiente al portal seleccionado
   */
  openPortalLogin(portalRole) {
    // Cerrar cualquier otro modal abierto
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

  /**
   * Procesa el inicio de sesión validando el portal específico
   */
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

      window.hideModal(modalId);
      window.showToast(`¡Bienvenido(a), ${res.user.nombre_completo}!`, 'success');
      this.updateUI();

      if (window.socketService) {
        window.socketService.joinUserRoom(res.user.id);
        if (res.user.rol_nombre === 'funcionario' || res.user.rol_nombre === 'superadmin') {
          window.socketService.joinStaffRoom();
        }
      }

      // Redirigir a vista según rol
      window.router.navigateToRoleDefault(res.user.rol_nombre);
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
    const user = this.currentUser;
    const authActions = document.getElementById('authActions');
    const userProfileMenu = document.getElementById('userProfileMenu');
    const navUserName = document.getElementById('navUserName');
    const navUserRole = document.getElementById('navUserRole');

    if (user) {
      if (authActions) authActions.style.display = 'none';
      if (userProfileMenu) userProfileMenu.style.display = 'flex';
      if (navUserName) navUserName.textContent = user.nombre_completo;
      if (navUserRole) {
        navUserRole.textContent = (user.rol_nombre || user.rol || '').toUpperCase();
        const rol = user.rol_nombre || user.rol;
        if (rol === 'superadmin') {
          navUserRole.className = 'status-badge proximo_terminar';
        } else if (rol === 'funcionario') {
          navUserRole.className = 'status-badge warning';
        } else {
          navUserRole.className = 'status-badge disponible';
        }
      }
    } else {
      if (authActions) authActions.style.display = 'flex';
      if (userProfileMenu) userProfileMenu.style.display = 'none';
    }

    this.renderNavLinks();
  },

  renderNavLinks() {
    const user = this.currentUser;
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
          <button class="btn btn-warning btn-sm" onclick="window.router.navigate('staffView')">
            <i class="fas fa-tasks"></i> Control Sala
          </button>
          <button class="btn btn-primary btn-sm" onclick="window.router.navigate('adminView')">
            <i class="fas fa-shield-alt"></i> Super Admin
          </button>
        `;
      }
    }

    navLinks.innerHTML = linksHtml;
  }
};

window.auth = auth;
