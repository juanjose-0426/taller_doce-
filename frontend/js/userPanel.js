const userPanel = {
  initialized: false,
  activeSession: null,
  timerInterval: null,
  myQueuePosition: null,

  async init() {
    await this.loadActiveSession();
    await this.loadQueuePosition();
    await this.loadAvailablePCs();
    await this.loadUserHistory();
    if (!this.initialized) {
      this.setupListeners();
      this.initialized = true;
    }
  },

  setupListeners() {
    window.addEventListener('realtime:pc-updated', () => {
      this.loadAvailablePCs();
      this.loadActiveSession();
    });

    window.addEventListener('realtime:queue-updated', () => {
      this.loadQueuePosition();
    });

    window.addEventListener('realtime:session-alert', () => {
      this.loadActiveSession();
    });

    window.addEventListener('realtime:session-ended', () => {
      this.stopTimer();
      this.activeSession = null;
      this.renderSessionState();
      this.loadQueuePosition();
      this.loadUserHistory();
    });

    window.addEventListener('realtime:queue-assigned', () => {
      this.loadActiveSession();
      this.loadQueuePosition();
    });
  },

  async loadActiveSession() {
    const res = await window.api.get('/sessions/my-active');
    if (res.success && res.hasActiveSession) {
      this.activeSession = res.session;
      this.startLiveTimer();
    } else {
      this.stopTimer();
      this.activeSession = null;
    }
    this.renderSessionState();
  },

  async loadQueuePosition() {
    const res = await window.api.get('/queue/my-position');
    if (res.success && res.inQueue) {
      this.myQueuePosition = res.data;
    } else {
      this.myQueuePosition = null;
    }
    this.renderQueueState();
  },

  async loadAvailablePCs() {
    const res = await window.api.get('/pcs/available');
    const container = document.getElementById('userAvailablePCsList');
    if (!container) return;

    if (res.success && res.data.length > 0) {
      container.innerHTML = res.data.map(pc => `
        <div class="pc-card border-disponible" style="padding: 1rem;">
          <div class="pc-card-header" style="margin-bottom: 0.5rem;">
            <div class="pc-id-group">
              <div class="pc-icon"><i class="fas fa-desktop"></i></div>
              <div>
                <div class="pc-name">${pc.nombre}</div>
                <div class="pc-location">${pc.ubicacion}</div>
              </div>
            </div>
            <span class="status-badge disponible">Disponible</span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            ${pc.descripcion || pc.especificaciones || 'Equipo estándar de consulta'}
          </div>
          <button class="btn btn-success btn-sm" style="width: 100%;" onclick="userPanel.requestStartSession(${pc.id})">
            <i class="fas fa-play"></i> Iniciar Uso Aquí
          </button>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
          <i class="fas fa-hourglass-half" style="font-size: 2rem; color: var(--status-warning); margin-bottom: 0.75rem;"></i>
          <h4 style="margin-bottom: 0.25rem;">No hay computadores libres en este momento</h4>
          <p style="color: var(--text-secondary); font-size: 0.85rem; max-width: 450px; margin: 0 auto 1rem;">
            Todos los equipos están en uso o reservados. Puedes unirte a la fila virtual para asegurar tu próximo turno.
          </p>
          ${!this.myQueuePosition && !this.activeSession ? `
            <button class="btn btn-primary" onclick="userPanel.joinQueue()">
              <i class="fas fa-ticket-alt"></i> Solicitar Turno Digital
            </button>
          ` : ''}
        </div>
      `;
    }
  },

  async loadUserHistory() {
    const res = await window.api.get('/sessions/my-history');
    const tbody = document.getElementById('userHistoryTableBody');
    if (!tbody) return;

    if (res.success && res.data.length > 0) {
      tbody.innerHTML = res.data.map(s => {
        const fecha = new Date(s.fecha_inicio).toLocaleDateString();
        const horaInicio = new Date(s.fecha_inicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const duracionMin = s.tiempo_utilizado ? Math.round(s.tiempo_utilizado / 60) : s.tiempo_maximo;
        return `
          <tr>
            <td><strong>${s.pc_nombre}</strong> (${s.pc_ubicacion})</td>
            <td>${fecha} ${horaInicio}</td>
            <td><span class="badge">${duracionMin} min</span></td>
            <td><span class="status-badge ${s.estado === 'finalizada' ? 'disponible' : 'ocupado'}">${s.estado}</span></td>
          </tr>
        `;
      }).join('');
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">
            Aún no tienes historial de sesiones registradas.
          </td>
        </tr>
      `;
    }
  },

  renderSessionState() {
    const container = document.getElementById('userSessionHeroContainer');
    if (!container) return;

    if (!this.activeSession) {
      container.innerHTML = `
        <div style="background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--radius-lg); padding: 2rem; text-align: center;">
          <i class="fas fa-power-off" style="font-size: 2.2rem; color: var(--text-muted); margin-bottom: 0.75rem;"></i>
          <h3>No tienes ninguna sesión activa</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 500px; margin: 0 auto 1.25rem;">
            Elige un computador disponible abajo o únete a la lista de espera para comenzar tu tiempo de uso en la biblioteca.
          </p>
        </div>
      `;
      return;
    }

    const s = this.activeSession;
    const isCritical = s.segundosRestantes <= 300;
    const isWarning = s.segundosRestantes <= 900;

    container.innerHTML = `
      <div class="active-session-hero ${isCritical ? 'critical' : ''}">
        <div class="active-session-left">
          <span class="active-session-badge">
            <i class="fas fa-broadcast-tower"></i> SESIÓN EN CURSO
          </span>
          <h2 class="active-session-title">Estás usando el equipo <strong>${s.pc_nombre}</strong></h2>
          <div class="active-session-meta">
            <span><i class="fas fa-map-marker-alt"></i> ${s.pc_ubicacion}</span>
            <span><i class="fas fa-stopwatch"></i> Límite: ${s.tiempo_maximo} minutos</span>
            <span><i class="fas fa-hourglass-start"></i> Transcurrido: ${Math.floor(s.segundosTranscurridos / 60)} min</span>
          </div>

          ${isCritical ? `
            <div style="background: rgba(220, 38, 38, 0.1); border: 1px solid var(--status-ocupado); padding: 0.75rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; color: #991b1b; display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
              <i class="fas fa-exclamation-triangle" style="color: var(--status-ocupado); font-size: 1.2rem;"></i>
              <div>
                <strong>¡Atención! Tu sesión está próxima a expirar.</strong>
                <p style="margin: 0; font-size: 0.78rem;">Guarda tus documentos y trabajos pendientes antes de que el equipo se cierre automáticamente.</p>
              </div>
            </div>
          ` : ''}

          <div style="margin-top: 1rem;">
            <button class="btn btn-danger" onclick="userPanel.confirmEndSession(${s.id})">
              <i class="fas fa-sign-out-alt"></i> Finalizar Mi Sesión Voluntariamente
            </button>
          </div>
        </div>

        <div class="timer-circle-widget">
          <svg class="circular-timer-svg" viewBox="0 0 140 140">
            <circle class="circular-timer-bg" cx="70" cy="70" r="60"></circle>
            <circle id="userCircleProgress" class="circular-timer-progress ${isCritical ? 'critical' : isWarning ? 'warning' : ''}" cx="70" cy="70" r="60"></circle>
          </svg>
          <div class="circular-timer-text">
            <span id="userTimeDisplay" class="timer-time-display">--:--</span>
            <span class="timer-time-sub">Restante</span>
          </div>
        </div>
      </div>
    `;

    this.updateClockUI();
  },

  renderQueueState() {
    const container = document.getElementById('userQueueCardContainer');
    if (!container) return;

    if (this.activeSession) {
      container.innerHTML = '';
      return;
    }

    if (this.myQueuePosition) {
      const q = this.myQueuePosition;
      container.innerHTML = `
        <div class="queue-card">
          <div class="queue-badge-number">
            <span class="queue-number-value">#${q.posicion}</span>
            <span class="queue-number-label">Tu Turno</span>
          </div>
          <div class="queue-details">
            <h4>Estás en la Fila de Espera Digital</h4>
            <p>
              Personas delante de ti: <strong>${q.personasDelante}</strong> &bull;
              Tiempo en espera: <strong>${q.minutosEspera} minutos</strong>.
            </p>
            <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
              <i class="fas fa-bell"></i> El sistema te notificará con una alarma y te asignará el equipo tan pronto como se libere.
            </p>
          </div>
          <div>
            <button class="btn btn-secondary btn-sm" onclick="userPanel.leaveQueue()">
              <i class="fas fa-times"></i> Cancelar Turno
            </button>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="queue-card" style="border-style: dashed;">
          <div class="queue-badge-number" style="background: var(--bg-elevated); color: var(--text-muted); box-shadow: none;">
            <i class="fas fa-users" style="font-size: 1.8rem;"></i>
          </div>
          <div class="queue-details">
            <h4>Fila de Espera Virtual</h4>
            <p>Si todos los computadores están ocupados, solicita un turno para esperar ordenadamente tu acceso.</p>
          </div>
          <div>
            <button class="btn btn-primary" onclick="userPanel.joinQueue()">
              <i class="fas fa-ticket-alt"></i> Tomar Turno en la Fila
            </button>
          </div>
        </div>
      `;
    }
  },

  startLiveTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      if (!this.activeSession) {
        this.stopTimer();
        return;
      }
      this.activeSession.segundosRestantes = Math.max(0, this.activeSession.segundosRestantes - 1);
      this.activeSession.segundosTranscurridos += 1;
      this.updateClockUI();

      if (this.activeSession.segundosRestantes <= 0) {
        this.stopTimer();
        this.loadActiveSession();
      }
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  },

  updateClockUI() {
    if (!this.activeSession) return;
    const timeDisplay = document.getElementById('userTimeDisplay');
    const circle = document.getElementById('userCircleProgress');
    if (!timeDisplay) return;

    const remaining = this.activeSession.segundosRestantes;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    timeDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (circle) {
      const totalSecs = (this.activeSession.tiempo_maximo || 60) * 60;
      const circumference = 2 * Math.PI * 60;
      const percent = Math.max(0, remaining / totalSecs);
      const offset = circumference * (1 - percent);
      circle.style.strokeDashoffset = offset;

      if (remaining <= 300) {
        circle.className.baseVal = 'circular-timer-progress critical';
      } else if (remaining <= 900) {
        circle.className.baseVal = 'circular-timer-progress warning';
      }
    }
  },

  async requestStartSession(computador_id) {
    if (this.activeSession) {
      window.showToast('Ya tienes una sesión activa en este momento.', 'warning');
      return;
    }

    const res = await window.api.post('/sessions/start', { computador_id });
    if (res.success) {
      window.showToast(res.message, 'success');
      await this.loadActiveSession();
      await this.loadAvailablePCs();
      await this.loadQueuePosition();
    } else {
      window.showToast(res.message, 'error');
    }
  },

  async confirmEndSession(sessionId) {
    if (!confirm('¿Estás seguro de que deseas finalizar tu sesión de uso ahora?')) return;

    const res = await window.api.post(`/sessions/${sessionId}/end`, { motivo: 'salida_voluntaria' });
    if (res.success) {
      window.showToast('Has liberado el computador exitosamente.', 'success');
      this.stopTimer();
      this.activeSession = null;
      this.renderSessionState();
      await this.loadAvailablePCs();
      await this.loadUserHistory();
    } else {
      window.showToast(res.message || 'Error al finalizar sesión.', 'error');
    }
  },

  async joinQueue() {
    const res = await window.api.post('/queue/join');
    if (res.success) {
      window.showToast(`¡Turno #${res.posicion} asignado! Estás en la fila.`, 'success');
      await this.loadQueuePosition();
    } else {
      window.showToast(res.message || 'No se pudo ingresar a la fila.', 'error');
    }
  },

  async leaveQueue() {
    if (!confirm('¿Deseas cancelar tu turno y salir de la lista de espera?')) return;

    const res = await window.api.post('/queue/leave');
    if (res.success) {
      window.showToast('Has salido de la lista de espera.', 'info');
      this.myQueuePosition = null;
      this.renderQueueState();
    } else {
      window.showToast(res.message || 'Error al salir de la lista.', 'error');
    }
  }
};

window.userPanel = userPanel;
