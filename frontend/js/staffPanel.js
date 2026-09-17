/**
 * BIBLIOTIEMPODOCE - PANEL DEL FUNCIONARIO (SALA DE CONTROL)
 * Monitoreo en vivo de computadores, temporizadores regresivos, control de sesiones y gestión de fila
 */

const staffPanel = {
  pcs: [],
  queue: [],
  timerInterval: null,

  async init() {
    await this.loadPCs();
    await this.loadQueue();
    this.startGlobalTimer();
    this.setupListeners();
  },

  setupListeners() {
    window.addEventListener('realtime:pc-updated', () => {
      this.loadPCs();
    });

    window.addEventListener('realtime:queue-updated', () => {
      this.loadQueue();
    });

    // Formulario de inicio de sesión manual para visitante
    const assignModalForm = document.getElementById('staffAssignSessionForm');
    if (assignModalForm) {
      assignModalForm.addEventListener('submit', (e) => this.handleManualAssign(e));
    }

    // Formulario de agregar usuario presencial a la fila
    const addQueueForm = document.getElementById('staffAddQueueForm');
    if (addQueueForm) {
      addQueueForm.addEventListener('submit', (e) => this.handleAddQueueUser(e));
    }
  },

  async loadPCs() {
    const res = await window.api.get('/pcs');
    if (res.success) {
      this.pcs = res.data;
      this.renderPCs();
      this.updateMetrics();
    }
  },

  async loadQueue() {
    const res = await window.api.get('/queue');
    if (res.success) {
      this.queue = res.data;
      this.renderQueue();
      this.updateMetrics();
    }
  },

  updateMetrics() {
    const totalPcs = this.pcs.length;
    const disponibles = this.pcs.filter(p => p.estado === 'disponible').length;
    const ocupados = this.pcs.filter(p => p.estado === 'ocupado' || p.estado === 'proximo_terminar').length;
    const mantenimiento = this.pcs.filter(p => p.estado === 'fuera_servicio').length;
    const enEspera = this.queue.length;

    const elTotal = document.getElementById('staffMetricTotal');
    const elDisp = document.getElementById('staffMetricDisp');
    const elOcup = document.getElementById('staffMetricOcup');
    const elCola = document.getElementById('staffMetricCola');

    if (elTotal) elTotal.textContent = totalPcs;
    if (elDisp) elDisp.textContent = disponibles;
    if (elOcup) elOcup.textContent = ocupados;
    if (elCola) elCola.textContent = enEspera;
  },

  renderPCs() {
    const grid = document.getElementById('staffPcGrid');
    if (!grid) return;

    grid.innerHTML = this.pcs.map(pc => {
      let borderClass = 'border-disponible';
      let badgeLabel = 'Disponible';
      let badgeClass = 'disponible';

      if (pc.estado === 'ocupado') {
        borderClass = 'border-ocupado';
        badgeLabel = 'Ocupado';
        badgeClass = 'ocupado';
      } else if (pc.estado === 'proximo_terminar') {
        borderClass = 'border-warning';
        badgeLabel = 'Próximo a Vencer';
        badgeClass = 'proximo_terminar';
      } else if (pc.estado === 'fuera_servicio') {
        borderClass = 'border-mantenimiento';
        badgeLabel = 'Fuera de Servicio';
        badgeClass = 'fuera_servicio';
      }

      const hasSession = pc.sesion_activa && (pc.estado === 'ocupado' || pc.estado === 'proximo_terminar');
      const rem = hasSession ? pc.sesion_activa.segundosRestantes : 0;
      const totalSecs = hasSession ? (pc.sesion_activa.tiempo_maximo * 60) : 3600;
      const percent = hasSession ? Math.max(0, Math.min(100, (rem / totalSecs) * 100)) : 0;
      const mins = Math.floor(rem / 60);
      const secs = rem % 60;
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      return `
        <div class="pc-card ${borderClass}" id="staff-pc-card-${pc.id}">
          <div class="pc-card-header">
            <div class="pc-id-group">
              <div class="pc-icon">
                <i class="fas fa-desktop"></i>
              </div>
              <div>
                <div class="pc-name">${pc.nombre}</div>
                <div class="pc-location">${pc.ubicacion}</div>
              </div>
            </div>
            <span class="status-badge ${badgeClass}">${badgeLabel}</span>
          </div>

          <div class="pc-card-body">
            ${hasSession ? `
              <div class="pc-user-info">
                <i class="fas fa-user"></i>
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <strong>${pc.sesion_activa.usuario_nombre}</strong>
                  <div style="font-size: 0.72rem; color: var(--text-secondary);">Doc: ${pc.sesion_activa.usuario_documento}</div>
                </div>
              </div>

              <div class="pc-timer-container">
                <div class="timer-bar-bg">
                  <div class="timer-bar-fill ${rem <= 300 ? 'warning' : ''}" style="width: ${percent}%;"></div>
                </div>
                <div class="timer-labels">
                  <span>Tiempo restante:</span>
                  <span class="timer-remaining ${rem <= 300 ? 'critical' : rem <= 900 ? 'warning' : ''}" id="staff-timer-val-${pc.id}">
                    ${timeStr}
                  </span>
                </div>
              </div>
            ` : `
              <div style="padding: 1.2rem 0; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                ${pc.estado === 'fuera_servicio' ? '<i class="fas fa-tools"></i> En mantenimiento técnico' : '<i class="fas fa-check-circle"></i> Computador listo para asignar'}
              </div>
            `}
          </div>

          <div class="pc-card-footer">
            ${pc.estado === 'disponible' ? `
              <button class="btn btn-success btn-sm" style="flex: 1;" onclick="staffPanel.openAssignModal(${pc.id}, '${pc.nombre}')">
                <i class="fas fa-user-plus"></i> Iniciar
              </button>
              <button class="btn btn-secondary btn-sm" title="Poner fuera de servicio" onclick="staffPanel.toggleMaintenance(${pc.id}, 'fuera_servicio')">
                <i class="fas fa-tools"></i>
              </button>
            ` : pc.estado === 'fuera_servicio' ? `
              <button class="btn btn-success btn-sm" style="flex: 1;" onclick="staffPanel.toggleMaintenance(${pc.id}, 'disponible')">
                <i class="fas fa-check"></i> Habilitar Equipo
              </button>
            ` : `
              <button class="btn btn-warning btn-sm" title="Extender 15 minutos" onclick="staffPanel.extendSession(${pc.sesion_activa.id}, 15)">
                <i class="fas fa-plus"></i> +15m
              </button>
              <button class="btn btn-warning btn-sm" title="Extender 30 minutos" onclick="staffPanel.extendSession(${pc.sesion_activa.id}, 30)">
                <i class="fas fa-plus"></i> +30m
              </button>
              <button class="btn btn-danger btn-sm" style="flex: 1;" onclick="staffPanel.forceEndSession(${pc.sesion_activa.id}, '${pc.nombre}')">
                <i class="fas fa-stop-circle"></i> Finalizar
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  },

  renderQueue() {
    const tbody = document.getElementById('staffQueueTableBody');
    const badgeCount = document.getElementById('staffQueueBadge');
    if (badgeCount) badgeCount.textContent = `${this.queue.length} en espera`;
    if (!tbody) return;

    if (this.queue.length > 0) {
      tbody.innerHTML = this.queue.map(item => {
        const horaLlegada = new Date(item.fecha_solicitud).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const esperaMin = item.minutosEspera || 0;
        return `
          <tr>
            <td><strong class="gradient-text" style="font-size: 1.1rem;">#${item.posicion}</strong></td>
            <td>
              <strong>${item.usuario_nombre}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${item.usuario_correo}</div>
            </td>
            <td>${item.usuario_documento}</td>
            <td>${horaLlegada} (${esperaMin} min esperando)</td>
            <td>
              <div style="display: flex; gap: 0.4rem;">
                <button class="btn btn-primary btn-sm" onclick="staffPanel.assignNextUser(${item.usuario_id})">
                  <i class="fas fa-arrow-right"></i> Asignar
                </button>
                <button class="btn btn-danger btn-sm" title="Remover de la fila" onclick="staffPanel.removeFromQueue(${item.usuario_id})">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            <i class="fas fa-check-circle" style="color: var(--status-disponible); font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
            No hay usuarios esperando en la fila.
          </td>
        </tr>
      `;
    }
  },

  startGlobalTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      let needsRerender = false;

      this.pcs.forEach(pc => {
        if (pc.sesion_activa && (pc.estado === 'ocupado' || pc.estado === 'proximo_terminar')) {
          pc.sesion_activa.segundosRestantes = Math.max(0, pc.sesion_activa.segundosRestantes - 1);
          pc.sesion_activa.segundosTranscurridos += 1;

          const el = document.getElementById(`staff-timer-val-${pc.id}`);
          if (el) {
            const rem = pc.sesion_activa.segundosRestantes;
            const mins = Math.floor(rem / 60);
            const secs = rem % 60;
            el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            if (rem <= 300) {
              el.className = 'timer-remaining critical';
            } else if (rem <= 900) {
              el.className = 'timer-remaining warning';
            }
          }

          if (pc.sesion_activa.segundosRestantes <= 0) {
            needsRerender = true;
          }
        }
      });

      if (needsRerender) {
        this.loadPCs();
      }
    }, 1000);
  },

  openAssignModal(pcId, pcName) {
    const inputId = document.getElementById('staffAssignPcId');
    const inputTitle = document.getElementById('staffAssignModalTitle');
    if (inputId) inputId.value = pcId;
    if (inputTitle) inputTitle.textContent = `Asignar Sesión en ${pcName}`;
    window.showModal('staffAssignModal');
  },

  async handleManualAssign(e) {
    e.preventDefault();
    const computador_id = document.getElementById('staffAssignPcId').value;
    const documento = document.getElementById('staffAssignUserDoc').value.trim();
    const tiempo_maximo = document.getElementById('staffAssignTime').value;

    if (!documento) {
      window.showToast('Ingresa el documento del usuario.', 'warning');
      return;
    }

    const res = await window.api.post('/sessions/start', {
      computador_id: parseInt(computador_id, 10),
      documento_usuario: documento,
      tiempo_maximo: parseInt(tiempo_maximo, 10) || 60
    });

    if (res.success) {
      window.showToast(res.message, 'success');
      window.hideModal('staffAssignModal');
      document.getElementById('staffAssignUserDoc').value = '';
      await this.loadPCs();
      await this.loadQueue();
    } else {
      window.showToast(res.message || 'Error al asignar sesión.', 'error');
    }
  },

  async assignNextUser(usuario_id) {
    const disponibles = this.pcs.filter(p => p.estado === 'disponible');
    if (disponibles.length === 0) {
      window.showToast('No hay computadores disponibles en este momento.', 'warning');
      return;
    }

    const pcElegido = disponibles[0];
    const res = await window.api.post('/queue/assign', {
      usuario_id,
      computador_id: pcElegido.id,
      tiempo_maximo: 60
    });

    if (res.success) {
      window.showToast(res.message, 'success');
      await this.loadPCs();
      await this.loadQueue();
    } else {
      window.showToast(res.message || 'Error al asignar equipo.', 'error');
    }
  },

  async extendSession(sessionId, minutes) {
    const res = await window.api.post(`/sessions/${sessionId}/extend`, { minutos: minutes });
    if (res.success) {
      window.showToast(`Se extendió la sesión en +${minutes} minutos.`, 'success');
      await this.loadPCs();
    } else {
      window.showToast(res.message || 'Error al extender tiempo.', 'error');
    }
  },

  async forceEndSession(sessionId, pcName) {
    if (!confirm(`¿Seguro que deseas finalizar forzadamente la sesión en ${pcName}?`)) return;

    const res = await window.api.post(`/sessions/${sessionId}/end`, { motivo: 'finalizada_por_funcionario' });
    if (res.success) {
      window.showToast(`Sesión en ${pcName} finalizada. Equipo libre.`, 'success');
      await this.loadPCs();
      await this.loadQueue();
    } else {
      window.showToast(res.message || 'Error al finalizar sesión.', 'error');
    }
  },

  async toggleMaintenance(pcId, nuevoEstado) {
    const res = await window.api.patch(`/pcs/${pcId}/status`, { estado: nuevoEstado });
    if (res.success) {
      window.showToast(`Estado del equipo actualizado a: ${nuevoEstado}`, 'info');
      await this.loadPCs();
    } else {
      window.showToast(res.message || 'Error al cambiar estado.', 'error');
    }
  },

  async handleAddQueueUser(e) {
    e.preventDefault();
    const documento = document.getElementById('staffAddQueueDoc').value.trim();
    if (!documento) return;

    // Buscar si el usuario existe, o entrar a la fila
    const res = await window.api.post('/queue/join', { documento });
    if (res.success) {
      window.showToast(res.message, 'success');
      window.hideModal('staffAddQueueModal');
      document.getElementById('staffAddQueueDoc').value = '';
      await this.loadQueue();
    } else {
      window.showToast(res.message || 'Error al agregar a la fila.', 'error');
    }
  },

  async removeFromQueue(usuario_id) {
    if (!confirm('¿Seguro que deseas remover este usuario de la fila?')) return;

    const res = await window.api.post('/queue/leave', { usuario_id });
    if (res.success) {
      window.showToast('Usuario removido de la fila.', 'info');
      await this.loadQueue();
    } else {
      window.showToast(res.message || 'Error al remover de la fila.', 'error');
    }
  }
};

window.staffPanel = staffPanel;
