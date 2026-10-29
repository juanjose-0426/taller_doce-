function startSystemClock() {
  const clockEl = document.getElementById('systemClockTime');
  const update = () => {
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  };
  update();
  setInterval(update, 1000);
}

const router = {
  currentView: 'publicView',

  navigate(viewName) {
    const user = window.api.getUser();
    const role = user ? (user.rol_nombre || user.rol) : null;

    if (viewName === 'userView' && !user) {
      window.showToast('Debes iniciar sesión para acceder a tu panel.', 'warning');
      if (window.auth) window.auth.openPortalLogin('usuario');
      return;
    }

    if (viewName === 'staffView' && (!user || (role !== 'funcionario' && role !== 'superadmin'))) {
      window.showToast('Acceso restringido para personal de la biblioteca.', 'error');
      return;
    }

    if (viewName === 'adminView' && (!user || role !== 'superadmin')) {
      window.showToast('Acceso restringido a Super Administradores.', 'error');
      return;
    }

    document.querySelectorAll('.view-section').forEach(view => {
      view.classList.remove('active');
    });

    const target = document.getElementById(viewName);
    if (target) {
      target.classList.add('active');
      this.currentView = viewName;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Asegurar que la interfaz y botones de ingreso estén sincronizados con la sesión
      if (window.auth) {
        window.auth.updateUI();
      }

      if (viewName === 'publicView') {
        app.loadPublicPCs();
      } else if (viewName === 'userView' && window.userPanel) {
        window.userPanel.init();
      } else if (viewName === 'staffView' && window.staffPanel) {
        window.staffPanel.init();
      } else if (viewName === 'adminView' && window.adminPanel) {
        window.adminPanel.init();
      }
    }
  },

  navigateToRoleDefault(role) {
    const user = window.api.getUser();
    const currentRole = role || (user ? (user.rol_nombre || user.rol) : null);
    if (currentRole === 'superadmin') {
      this.navigate('adminView');
    } else if (currentRole === 'funcionario') {
      this.navigate('staffView');
    } else if (currentRole === 'usuario') {
      this.navigate('userView');
    } else {
      this.navigate('publicView');
    }
  }
};

window.router = router;

const app = {
  async init() {
    if (window.componentLoader) {
      await window.componentLoader.loadAll();
    }

    startSystemClock();

    if (window.socketService) {
      window.socketService.init();
    }

    if (window.auth) {
      window.auth.init();
    }

    this.setupNotifications();

    const user = window.api.getUser();
    if (user) {
      router.navigateToRoleDefault(user.rol_nombre || user.rol);
    } else {
      router.navigate('publicView');
    }

    // Actualizar estado de portales tras cargar componentes
    if (window.auth) {
      window.auth.updateUI();
    }

    window.addEventListener('realtime:pc-updated', () => {
      if (router.currentView === 'publicView') {
        this.loadPublicPCs();
      }
    });
  },

  async loadPublicPCs() {
    const res = await window.api.get('/pcs');
    const container = document.getElementById('publicPcGrid');
    if (!container) return;

    if (res.success && res.data.length > 0) {
      const pcs = res.data;
      const disponibles = pcs.filter(p => p.estado === 'disponible').length;
      const ocupados = pcs.filter(p => p.estado === 'ocupado' || p.estado === 'proximo_terminar').length;

      const elDisp = document.getElementById('publicCountDisp');
      const elOcup = document.getElementById('publicCountOcup');
      if (elDisp) elDisp.textContent = disponibles;
      if (elOcup) elOcup.textContent = ocupados;

      container.innerHTML = pcs.map(pc => {
        let borderClass = 'border-disponible';
        let badgeClass = 'disponible';
        let badgeText = 'Disponible';

        if (pc.estado === 'ocupado') {
          borderClass = 'border-ocupado';
          badgeClass = 'ocupado';
          badgeText = 'En Uso';
        } else if (pc.estado === 'proximo_terminar') {
          borderClass = 'border-warning';
          badgeClass = 'proximo_terminar';
          badgeText = 'Por Terminar';
        } else if (pc.estado === 'fuera_servicio') {
          borderClass = 'border-mantenimiento';
          badgeClass = 'fuera_servicio';
          badgeText = 'Mantenimiento';
        }

        return `
          <div class="pc-card ${borderClass}">
            <div class="pc-card-header">
              <div class="pc-id-group">
                <div class="pc-icon"><i class="fas fa-desktop"></i></div>
                <div>
                  <div class="pc-name">${pc.nombre}</div>
                  <div class="pc-location">${pc.ubicacion}</div>
                </div>
              </div>
              <span class="status-badge ${badgeClass}">${badgeText}</span>
            </div>

            <div class="pc-card-body">
              <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                ${pc.especificaciones || 'Equipo de consulta bibliográfica'}
              </p>
              ${pc.sesion_activa ? `
                <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.35rem;">
                  <i class="fas fa-clock"></i> Sesión activa en curso
                </div>
              ` : `
                <div style="font-size: 0.75rem; color: var(--status-disponible); display: flex; align-items: center; gap: 0.35rem;">
                  <i class="fas fa-check-circle"></i> Listo para usar
                </div>
              `}
            </div>
          </div>
        `;
      }).join('');
    }
  },

  setupNotifications() {
    const toggleBtn = document.getElementById('notificationToggleBtn');
    const closeBtn = document.getElementById('closeNotificationDrawerBtn');
    const readAllBtn = document.getElementById('markAllNotificationsReadBtn');
    const drawer = document.getElementById('notificationDrawer');

    if (toggleBtn && drawer) {
      toggleBtn.addEventListener('click', () => {
        drawer.classList.toggle('active');
        if (drawer.classList.contains('active')) {
          this.loadNotifications();
        }
      });
    }

    if (closeBtn && drawer) {
      closeBtn.addEventListener('click', () => {
        drawer.classList.remove('active');
      });
    }

    if (readAllBtn) {
      readAllBtn.addEventListener('click', async () => {
        await window.api.patch('/notifications/read-all');
        this.loadNotifications();
      });
    }

    this.refreshNotificationBadge();
  },

  async refreshNotificationBadge() {
    const user = window.api.getUser();
    if (!user) return;

    const res = await window.api.get('/notifications');
    const badge = document.getElementById('navNotificationBadge');
    if (badge && res.success) {
      if (res.unreadCount > 0) {
        badge.textContent = res.unreadCount;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  },

  async loadNotifications() {
    const res = await window.api.get('/notifications');
    const list = document.getElementById('notificationsList');
    if (!list) return;

    if (res.success && res.data.length > 0) {
      list.innerHTML = res.data.map(n => `
        <div class="notif-item ${n.estado === 'no_leida' ? 'unread' : ''}" onclick="app.markNotificationRead(${n.id})">
          <div class="notif-header-item">
            <span>${new Date(n.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            ${n.estado === 'no_leida' ? '<span style="color: var(--primary); font-weight: bold;">Nueva</span>' : ''}
          </div>
          <div class="notif-title">${n.titulo}</div>
          <div class="notif-body">${n.mensaje}</div>
        </div>
      `).join('');
      this.refreshNotificationBadge();
    } else {
      list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No tienes notificaciones pendientes.</div>';
    }
  },

  async markNotificationRead(id) {
    await window.api.patch(`/notifications/${id}/read`);
    this.loadNotifications();
  }
};

window.app = app;

window.showModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
};

window.hideModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
};

window.showToast = function(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || 'fa-info-circle'} toast-icon"></i>
    <div class="toast-message">${message}</div>
    <button onclick="this.parentElement.remove()" style="color: var(--text-muted); font-size: 0.85rem;"><i class="fas fa-times"></i></button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4500);
};

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
