// DEX ARM 01: Professional Robotics Telemetry & Scientific Analysis HUD
// Displays real-time:
// 1. Tendon Tensions (N) & Anatomical Biomechanics
// 2. Ferrari-Canny Grasp Wrench Space Quality (epsilon) & Force Closure Status
// 3. Yoshikawa Kinematic Manipulability (w) & Singularity Avoidance
// 4. Harmonic Drive Actuator Torques (Nm) & Thermal Saturation (°C)
// 5. Interactive 6D IK Drag Mode & Manipulability Ellipsoid Toggles

import * as THREE from 'three';

export function initTelemetryHUD(api) {
  const existing = document.getElementById('telemetry-hud');
  if (existing) existing.remove();

  const hud = document.createElement('aside');
  hud.id = 'telemetry-hud';
  hud.setAttribute('aria-label', 'Real-time Actuator, Tendon & Kinematic Telemetry');

  hud.innerHTML = `
    <div class="hud-header">
      <span class="hud-live-tag">● LIVE</span>
      <span class="hud-title">TELEMETRY // RAMA O1</span>
      <button class="hud-toggle" id="hudToggle" type="button" aria-label="Collapse telemetry">−</button>
    </div>
    <div class="hud-body" id="hudBody">

      <!-- Kinematics & Manipulability -->
      <div class="hud-section">
        <div class="hud-label">
          <span>KINEMATIC DEXTERITY</span>
          <span class="hud-val" id="hudManipVal">w: 0.84</span>
        </div>
        <div class="hud-manip-bar">
          <div class="hud-manip-fill" id="hudManipFill" style="width: 84%;"></div>
        </div>
        <div class="hud-stat-sub">
          <span id="hudSingularityLabel" style="color:var(--hud-accent, #38bdf8);">NOMINAL DEXTERITY</span>
          <span id="hudReachDist">Reach: 520 mm</span>
        </div>
      </div>

      <!-- Grasp Wrench Space & Force Closure -->
      <div class="hud-section">
        <div class="hud-label">
          <span>GRASP QUALITY (FERRARI-CANNY)</span>
          <span class="hud-val" id="hudEpsilonVal">ε = 0.00</span>
        </div>
        <div class="hud-badge-row">
          <span class="hud-badge" id="hudGraspBadge">OPEN / UNCONSTRAINED</span>
        </div>
      </div>

      <!-- Tendon Tension Array -->
      <div class="hud-section">
        <div class="hud-label">
          <span>TENDON TENSION</span>
          <span class="hud-val" id="hudTendonMax">6 N</span>
        </div>
        <div class="tendon-grid">
          <div class="tendon-col" title="Thumb Tendons (4 lines)">
            <div class="tendon-track"><div class="tendon-bar" id="tbar-thumb"></div></div>
            <span class="tendon-lbl">TH</span>
            <span class="tendon-num" id="tnum-thumb">6N</span>
          </div>
          <div class="tendon-col" title="Index Tendons (5 lines)">
            <div class="tendon-track"><div class="tendon-bar" id="tbar-index"></div></div>
            <span class="tendon-lbl">IN</span>
            <span class="tendon-num" id="tnum-index">6N</span>
          </div>
          <div class="tendon-col" title="Middle Tendons (5 lines)">
            <div class="tendon-track"><div class="tendon-bar" id="tbar-middle"></div></div>
            <span class="tendon-lbl">MD</span>
            <span class="tendon-num" id="tnum-middle">6N</span>
          </div>
          <div class="tendon-col" title="Ring Tendons (5 lines)">
            <div class="tendon-track"><div class="tendon-bar" id="tbar-ring"></div></div>
            <span class="tendon-lbl">RN</span>
            <span class="tendon-num" id="tnum-ring">6N</span>
          </div>
          <div class="tendon-col" title="Little Tendons (5 lines)">
            <div class="tendon-track"><div class="tendon-bar" id="tbar-little"></div></div>
            <span class="tendon-lbl">LT</span>
            <span class="tendon-num" id="tnum-little">6N</span>
          </div>
        </div>
      </div>

      <!-- Harmonic Drive Actuator Torques & Thermal Status -->
      <div class="hud-section">
        <div class="hud-label">
          <span>ACTUATOR TORQUE & TEMP</span>
          <span class="hud-val" id="hudArmTorque">RMS 18 Nm</span>
        </div>
        <div class="torque-list" id="torqueList">
          <div class="torque-row"><span class="t-name">J1 Base</span><div class="t-track"><div class="t-fill" id="torq-0" style="width:14%"></div></div><span class="t-val" id="tval-0">16 Nm</span><span class="t-temp" id="ttemp-0">26°C</span></div>
          <div class="torque-row"><span class="t-name">J2 Shldr</span><div class="t-track"><div class="t-fill" id="torq-1" style="width:38%"></div></div><span class="t-val" id="tval-1">45 Nm</span><span class="t-temp" id="ttemp-1">29°C</span></div>
          <div class="torque-row"><span class="t-name">J3 S-Roll</span><div class="t-track"><div class="t-fill" id="torq-2" style="width:18%"></div></div><span class="t-val" id="tval-2">14 Nm</span><span class="t-temp" id="ttemp-2">26°C</span></div>
          <div class="torque-row"><span class="t-name">J4 Elbow</span><div class="t-track"><div class="t-fill" id="torq-3" style="width:32%"></div></div><span class="t-val" id="tval-3">25 Nm</span><span class="t-temp" id="ttemp-3">28°C</span></div>
          <div class="torque-row"><span class="t-name">J5 F-Roll</span><div class="t-track"><div class="t-fill" id="torq-4" style="width:12%"></div></div><span class="t-val" id="tval-4">4 Nm</span><span class="t-temp" id="ttemp-4">25°C</span></div>
          <div class="torque-row"><span class="t-name">J6 Wrist</span><div class="t-track"><div class="t-fill" id="torq-5" style="width:20%"></div></div><span class="t-val" id="tval-5">7 Nm</span><span class="t-temp" id="ttemp-5">25°C</span></div>
          <div class="torque-row"><span class="t-name">J7 W-Roll</span><div class="t-track"><div class="t-fill" id="torq-6" style="width:8%"></div></div><span class="t-val" id="tval-6">2 Nm</span><span class="t-temp" id="ttemp-6">25°C</span></div>
        </div>
      </div>

      <!-- Distal Tactile Pressure Array -->
      <div class="hud-section hud-tactile">
        <div class="hud-label">
          <span>DISTAL TACTILE ARRAY</span>
          <span class="hud-val" id="hudTactileTotal">0.0 N</span>
        </div>
        <div class="tactile-dots">
          <div class="tactile-item" id="tac-thumb"><span class="tdot"></span><span class="tlbl">T</span></div>
          <div class="tactile-item" id="tac-index"><span class="tdot"></span><span class="tlbl">I</span></div>
          <div class="tactile-item" id="tac-middle"><span class="tdot"></span><span class="tlbl">M</span></div>
          <div class="tactile-item" id="tac-ring"><span class="tdot"></span><span class="tlbl">R</span></div>
          <div class="tactile-item" id="tac-little"><span class="tdot"></span><span class="tlbl">L</span></div>
        </div>
      </div>

      <!-- Self-Collision & Workspace Clearance -->
      <div class="hud-section">
        <div class="hud-label">
          <span>SELF-COLLISION & WORKSPACE</span>
          <span class="hud-val" id="hudClearanceVal">>100 mm</span>
        </div>
        <div class="hud-badge-row">
          <span class="hud-badge fc-locked" id="hudCollisionBadge">CLEAR (NOMINAL)</span>
        </div>
      </div>

      <!-- Interactive Controls -->
      <div class="hud-section hud-actions">
        <div class="hud-btn-grid" style="grid-template-columns: 1fr 1fr 1fr;">
          <button class="hud-btn" id="btnToggleIK" type="button">IK Gizmo: OFF</button>
          <button class="hud-btn" id="btnToggleEllipsoid" type="button">Ellipsoid: OFF</button>
          <button class="hud-btn" id="btnToggleTactile" type="button">Tactile 3D: OFF</button>
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(hud);

  // Toggle minimize
  let collapsed = false;
  const toggleBtn = document.getElementById('hudToggle');
  const hudBody = document.getElementById('hudBody');
  toggleBtn.onclick = () => {
    collapsed = !collapsed;
    hud.classList.toggle('collapsed', collapsed);
    toggleBtn.textContent = collapsed ? '+' : '−';
  };

  // Cache element references
  const fingers = ['thumb', 'index', 'middle', 'ring', 'little'];
  const tbars = fingers.map(f => document.getElementById(`tbar-${f}`));
  const tnums = fingers.map(f => document.getElementById(`tnum-${f}`));
  const tdots = fingers.map(f => document.getElementById(`tac-${f}`));

  const tfills = [0, 1, 2, 3, 4, 5, 6].map(i => document.getElementById(`torq-${i}`));
  const tvals = [0, 1, 2, 3, 4, 5, 6].map(i => document.getElementById(`tval-${i}`));
  const ttemps = [0, 1, 2, 3, 4, 5, 6].map(i => document.getElementById(`ttemp-${i}`));

  const manipValEl = document.getElementById('hudManipVal');
  const manipFillEl = document.getElementById('hudManipFill');
  const singularityLabelEl = document.getElementById('hudSingularityLabel');
  const reachDistEl = document.getElementById('hudReachDist');

  const epsilonValEl = document.getElementById('hudEpsilonVal');
  const graspBadgeEl = document.getElementById('hudGraspBadge');

  const btnToggleIK = document.getElementById('btnToggleIK');
  const btnToggleEllipsoid = document.getElementById('btnToggleEllipsoid');
  const btnToggleTactile = document.getElementById('btnToggleTactile');

  // IK Toggle handler
  let ikActive = false;
  btnToggleIK.onclick = () => {
    ikActive = !ikActive;
    if (api.ikSolver) {
      api.ikSolver.setEnabled(ikActive);
      btnToggleIK.textContent = ikActive ? 'IK Gizmo: ON' : 'IK Gizmo: OFF';
      btnToggleIK.classList.toggle('on', ikActive);
    }
  };

  // Ellipsoid Toggle handler
  let ellipsoidActive = false;
  btnToggleEllipsoid.onclick = () => {
    ellipsoidActive = !ellipsoidActive;
    if (api.ikSolver) {
      api.ikSolver.setEllipsoidVisible(ellipsoidActive);
      btnToggleEllipsoid.textContent = ellipsoidActive ? 'Ellipsoid: ON' : 'Ellipsoid: OFF';
      btnToggleEllipsoid.classList.toggle('on', ellipsoidActive);
    }
  };

  // Tactile 3D Visualizer Toggle
  let tactileActive = false;
  if (btnToggleTactile) {
    btnToggleTactile.onclick = () => {
      tactileActive = !tactileActive;
      api.setTactileForces?.(tactileActive);
      btnToggleTactile.textContent = tactileActive ? 'Tactile 3D: ON' : 'Tactile 3D: OFF';
      btnToggleTactile.classList.toggle('on', tactileActive);
    };
  }

  // Real-time update function
  function update(dt = 0.016) {
    if (!api) return;

    // 1. Biomechanics & Tendons
    if (api.biomechanics) {
      const tensions = api.biomechanics.getFingerTensions();
      let maxTension = 0;
      let totalContact = 0;

      fingers.forEach((f, idx) => {
        const val = tensions[f] || 6.0;
        if (val > maxTension) maxTension = val;

        const pct = Math.min(100, (val / 42) * 100);
        if (tbars[idx]) {
          tbars[idx].style.height = `${pct.toFixed(0)}%`;
          tbars[idx].style.background = pct > 65 ? 'var(--hud-warn, #f97316)' : 'var(--hud-accent, #38bdf8)';
        }
        if (tnums[idx]) {
          tnums[idx].textContent = `${val.toFixed(0)}N`;
        }

        const isContact = val > 16.0;
        if (tdots[idx]) tdots[idx].classList.toggle('active', isContact);
        if (isContact) totalContact += (val - 16.0) * 0.4;
      });

      const maxTendonEl = document.getElementById('hudTendonMax');
      if (maxTendonEl) maxTendonEl.textContent = `${maxTension.toFixed(0)} N`;

      const tactileTotalEl = document.getElementById('hudTactileTotal');
      if (tactileTotalEl) tactileTotalEl.textContent = `${totalContact.toFixed(1)} N`;

      // 2. Grasp Wrench Space Quality
      const grasp = api.biomechanics.evaluateGraspQuality();
      if (epsilonValEl) epsilonValEl.textContent = `ε = ${grasp.epsilon.toFixed(2)}`;
      if (graspBadgeEl) {
        graspBadgeEl.textContent = grasp.status;
        graspBadgeEl.className = 'hud-badge ' + (grasp.isForceClosure ? 'fc-locked' : (grasp.activeContacts > 0 ? 'fc-contact' : 'fc-open'));
      }
    }

    // 3. Actuator Dynamics & Thermal Saturation
    if (api.dynamics) {
      api.dynamics.updateThermal(dt);
      const statusList = api.dynamics.getActuatorStatus();

      let sumSquareTorque = 0;
      statusList.forEach((st, i) => {
        sumSquareTorque += st.torqueNm * st.torqueNm;

        const pct = Math.min(100, (st.torqueNm / st.peakTorque) * 100);
        if (tfills[i]) {
          tfills[i].style.width = `${pct.toFixed(0)}%`;
          tfills[i].style.background = st.temperatureC > 75 ? '#ef4444' : (pct > 65 ? '#f97316' : 'var(--hud-accent, #38bdf8)');
        }
        if (tvals[i]) tvals[i].textContent = `${st.torqueNm.toFixed(0)} Nm`;
        if (ttemps[i]) {
          ttemps[i].textContent = `${st.temperatureC.toFixed(0)}°C`;
          ttemps[i].style.color = st.temperatureC > 75 ? '#ef4444' : 'inherit';
        }
      });

      const rmsTorque = Math.sqrt(sumSquareTorque / 7);
      const armTorqueEl = document.getElementById('hudArmTorque');
      if (armTorqueEl) armTorqueEl.textContent = `RMS ${rmsTorque.toFixed(0)} Nm`;
    }

    // 4. Kinematics & Yoshikawa Manipulability
    if (api.ikSolver) {
      const w = api.ikSolver.updateManipulability();
      if (manipValEl) manipValEl.textContent = `w: ${w.toFixed(2)}`;
      if (manipFillEl) {
        manipFillEl.style.width = `${(w * 100).toFixed(0)}%`;
        manipFillEl.style.background = w < 0.25 ? '#ef4444' : (w < 0.55 ? '#f59e0b' : 'var(--hud-accent, #38bdf8)');
      }
      if (singularityLabelEl) {
        if (w < 0.22) {
          singularityLabelEl.textContent = '⚠ SINGULARITY PROXIMITY';
          singularityLabelEl.style.color = '#ef4444';
        } else if (w < 0.50) {
          singularityLabelEl.textContent = 'RESTRICTED MOBILITY';
          singularityLabelEl.style.color = '#f59e0b';
        } else {
          singularityLabelEl.textContent = 'NOMINAL DEXTERITY';
          singularityLabelEl.style.color = 'var(--hud-accent, #38bdf8)';
        }
      }

      // Live Reach Distance
      const p = api.ikSolver.eeNode?.getWorldPosition(new THREE.Vector3());
      if (p && reachDistEl) {
        const d = (p.length() * 1000).toFixed(0);
        reachDistEl.textContent = `Reach: ${d} mm`;
      }
    }

    // 5. Self-Collision & Workspace Safety
    if (api.collisionChecker) {
      const col = api.collisionChecker.check();
      const clearanceEl = document.getElementById('hudClearanceVal');
      const badgeEl = document.getElementById('hudCollisionBadge');
      if (clearanceEl) {
        clearanceEl.textContent = `${col.minClearanceMm} mm ${col.activePair ? '(' + col.activePair + ')' : ''}`;
      }
      if (badgeEl) {
        if (col.status === 'CLEAR') {
          badgeEl.textContent = `CLEAR · MIN ${col.minClearanceMm} MM`;
          badgeEl.className = 'hud-badge fc-locked';
          badgeEl.style.borderColor = '#10b981';
          badgeEl.style.color = '#10b981';
        } else if (col.status === 'PROXIMITY') {
          badgeEl.textContent = `PROXIMITY ALERT (${col.minClearanceMm} MM)`;
          badgeEl.className = 'hud-badge fc-contact';
          badgeEl.style.borderColor = '#f59e0b';
          badgeEl.style.color = '#f59e0b';
        } else {
          badgeEl.textContent = `COLLISION DETECTED`;
          badgeEl.className = 'hud-badge fc-open';
          badgeEl.style.borderColor = '#ef4444';
          badgeEl.style.color = '#ef4444';
        }
      }
    }
  }

  // Animation frame loop
  let lastTime = performance.now();
  let raf = null;
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      hud.remove();
    }
  };
}
