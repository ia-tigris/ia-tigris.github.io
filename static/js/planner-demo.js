(function () {
  'use strict';

  var COST_PER_GRID_UNIT = 5.3;

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function pointInPolygon(x, y, polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i][0];
      var yi = polygon[i][1];
      var xj = polygon[j][0];
      var yj = polygon[j][1];

      var intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
      if (intersect) {
        inside = !inside;
      }
    }
    return inside;
  }

  function dist2(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function dist(a, b) {
    return Math.sqrt(dist2(a, b));
  }

  function isDescendantOf(node, ancestor) {
    var cur = node;
    while (cur) {
      if (cur === ancestor) {
        return true;
      }
      cur = cur.parent;
    }
    return false;
  }

  function makeScenarios(gridW, gridH) {
    function scale(poly) {
      return poly.map(function (p) {
        return [p[0] * gridW, p[1] * gridH];
      });
    }

    return {
      wideAreaCoverage: {
        label: 'Wide-Area Coverage',
        polygon: scale([
          [0.06, 0.10], [0.88, 0.06], [0.95, 0.34], [0.90, 0.82], [0.24, 0.92], [0.07, 0.64]
        ]),
        start: { x: 0.16 * gridW, y: 0.20 * gridH },
        footprint: 3.2,
        obsStrength: 0.51,
        priors: [
          { x: 0.73 * gridW, y: 0.63 * gridH, sigma: 5.0, gain: 0.72, priority: 2.1 },
          { x: 0.47 * gridW, y: 0.40 * gridH, sigma: 4.4, gain: 0.58, priority: 1.8 }
        ]
      },
      corridorBottleneck: {
        label: 'Corridor Bottleneck',
        polygon: scale([
          [0.08, 0.58], [0.24, 0.56], [0.40, 0.53], [0.58, 0.51], [0.68, 0.48], [0.72, 0.40], [0.78, 0.30],
          [0.90, 0.26], [0.95, 0.36], [0.95, 0.76], [0.80, 0.84], [0.66, 0.76], [0.58, 0.67], [0.42, 0.66],
          [0.24, 0.66], [0.10, 0.72]
        ]),
        start: { x: 0.12 * gridW, y: 0.64 * gridH },
        footprint: 2.6,
        obsStrength: 0.40,
        priors: [
          { x: 0.86 * gridW, y: 0.62 * gridH, sigma: 3.2, gain: 0.78, priority: 2.6 },
          { x: 0.50 * gridW, y: 0.58 * gridH, sigma: 2.6, gain: 0.40, priority: 1.3 }
        ]
      },
      popUpEventReplan: {
        label: 'Pop-Up Event Replan',
        polygon: scale([
          [0.08, 0.16], [0.86, 0.11], [0.94, 0.34], [0.90, 0.84], [0.18, 0.90], [0.09, 0.64]
        ]),
        start: { x: 0.16 * gridW, y: 0.24 * gridH },
        footprint: 3.0,
        obsStrength: 0.51,
        priors: [
          { x: 0.32 * gridW, y: 0.46 * gridH, sigma: 4.1, gain: 0.68, priority: 2.0 },
          { x: 0.46 * gridW, y: 0.34 * gridH, sigma: 3.3, gain: 0.50, priority: 1.6 }
        ],
        eventTrigger: {
          type: 'recycles',
          count: 3
        },
        eventMode: 'replace',
        eventPriors: [
          { x: 0.80 * gridW, y: 0.70 * gridH, sigma: 3.7, gain: 0.86, priority: 2.8 },
          { x: 0.68 * gridW, y: 0.46 * gridH, sigma: 2.9, gain: 0.56, priority: 1.9 }
        ],
        eventLabelSuffix: 'Event active'
      },
      multiClusterHorizon: {
        label: 'Multi-Cluster Horizon',
        polygon: scale([
          [0.08, 0.16], [0.86, 0.10], [0.94, 0.32], [0.90, 0.84], [0.20, 0.92], [0.10, 0.70]
        ]),
        start: { x: 0.14 * gridW, y: 0.26 * gridH },
        footprint: 2.9,
        obsStrength: 0.50,
        priors: [
          { x: 0.36 * gridW, y: 0.30 * gridH, sigma: 1.6, gain: 0.58, priority: 2.0 },
          { x: 0.54 * gridW, y: 0.56 * gridH, sigma: 2.1, gain: 0.62, priority: 2.2 },
          { x: 0.72 * gridW, y: 0.32 * gridH, sigma: 1.5, gain: 0.64, priority: 2.3 },
          { x: 0.82 * gridW, y: 0.68 * gridH, sigma: 2.2, gain: 0.60, priority: 2.1 }
        ]
      }
    };
  }

  function PlannerDemo(root) {
    this.gridW = 48;
    this.gridH = 30;
    this.cellCount = this.gridW * this.gridH;

    this.scenarios = makeScenarios(this.gridW, this.gridH);

    this.canvas = root.canvas;
    this.ctx = this.canvas.getContext('2d');

    this.statusEl = root.status;
    this.hintEl = root.hint;
    this.controls = root.controls;

    this.uiMode = 'manual';
    this.manualSamplesPerFrame = 100;
    this.autoPlanningSliceMs = 10;
    this.autoPlanningSliceMovingMs = 4;
    this.autoRenderEveryN = 25;
    this.minMoveDurationMs = 180;
    this.running = false;
    this.rafId = null;

    this.state = null;

    this.wireControls();
    this.populateScenarioSelect();
    this.reset();
  }

  PlannerDemo.prototype.populateScenarioSelect = function () {
    var scenarioSelect = this.controls.scenario;
    var keys = Object.keys(this.scenarios);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = this.scenarios[k].label;
      scenarioSelect.appendChild(opt);
    }
    scenarioSelect.value = keys[0];
  };

  PlannerDemo.prototype.wireControls = function () {
    var self = this;
    var c = this.controls;

    function updateSliderLabels() {
      c.budgetValue.textContent = c.budget.value;
      c.planningHorizonValue.textContent = c.planningHorizon.value;
      c.maxSamplesValue.textContent = c.maxSamples.value;
      c.footprintValue.textContent = Number(c.footprint.value).toFixed(1);
      c.obsStrengthValue.textContent = Number(c.obsStrength.value).toFixed(2);
      c.extendDistanceValue.textContent = Number(c.extendDistance.value).toFixed(1);
      c.extendRadiusValue.textContent = Number(c.extendRadius.value).toFixed(1);
      c.pruneRadiusValue.textContent = Number(c.pruneRadius.value).toFixed(1);
      c.autoSpeedValue.textContent = Number(c.autoSpeed.value).toFixed(1);
      c.autoMaxPlanTimeValue.textContent = Number(c.autoMaxPlanTime.value).toFixed(1);
      c.autoExecDelayValue.textContent = Number(c.autoExecDelay.value).toFixed(1);
    }

    c.scenario.addEventListener('change', function () {
      self.reset();
    });

    c.budget.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.maxSamples.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.planningHorizon.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.seed.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.extendDistance.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.extendRadius.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.pruneRadius.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.footprint.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.obsStrength.addEventListener('input', function () {
      updateSliderLabels();
      self.reset();
    });

    c.autoSpeed.addEventListener('input', function () {
      updateSliderLabels();
      if (self.state) {
        self.state.autoRobotSpeed = Number(c.autoSpeed.value);
      }
    });

    c.autoMaxPlanTime.addEventListener('input', function () {
      updateSliderLabels();
      if (self.state) {
        self.state.autoMaxPlanWindowMs = Number(c.autoMaxPlanTime.value) * 1000;
      }
    });

    c.autoExecDelay.addEventListener('input', function () {
      updateSliderLabels();
      if (self.state) {
        self.state.autoExecuteDelayMs = Number(c.autoExecDelay.value) * 1000;
      }
    });

    c.deterministic.addEventListener('change', function () {
      self.reset();
    });

    c.includeEdge.addEventListener('change', function () {
      self.reset();
    });

    c.run.addEventListener('click', function () {
      if (!self.state) {
        return;
      }
      if (self.state && self.state.uiMode !== 'manual') {
        return;
      }
      self.running = true;
      self.state.autoRunning = false;
      self.tick();
    });

    c.pause.addEventListener('click', function () {
      self.stopLoops('');
      self.render();
    });

    c.step.addEventListener('click', function () {
      if (self.state && self.state.uiMode !== 'manual') {
        return;
      }
      self.stopLoops('');
      self.plannerStep();
      self.render();
    });

    c.replan.addEventListener('click', function () {
      if (self.state && self.state.uiMode !== 'manual') {
        return;
      }
      self.stopLoops('');
      self.replanTreeStep();
      self.render();
    });

    c.modeManual.addEventListener('click', function () {
      self.setMode('manual');
    });

    c.modeAuto.addEventListener('click', function () {
      self.setMode('auto');
    });

    c.autoStart.addEventListener('click', function () {
      self.startAutoCycle();
    });

    c.autoStop.addEventListener('click', function () {
      self.stopAutoCycle('Stopped by user.');
      self.render();
    });

    c.reset.addEventListener('click', function () {
      self.reset();
    });

    updateSliderLabels();
  };

  PlannerDemo.prototype.stopLoops = function (autoReason) {
    this.running = false;
    if (this.state) {
      this.state.autoRunning = false;
      if (autoReason !== undefined && autoReason !== null) {
        this.state.autoStopReason = autoReason;
      }
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  };

  PlannerDemo.prototype.setMode = function (mode) {
    var nextMode = mode === 'auto' ? 'auto' : 'manual';
    this.uiMode = nextMode;
    this.stopLoops(nextMode === 'auto'
      ? 'Auto mode selected.'
      : '');
    if (this.state) {
      this.state.uiMode = nextMode;
      this.state.autoPhase = 'planning';
      this.state.autoPlanWindowStartTs = 0;
      this.state.autoStopReason = '';
      this.state.autoStallCycles = 0;
      this.state.moveActive = false;
      this.state.pendingRecycleTs = 0;
    }
    this.render();
  };

  PlannerDemo.prototype.canExecuteCurrentPlan = function () {
    return !!(this.state.bestPath && this.state.bestPath.length > 1 && this.state.plannedSinceRecycle);
  };

  PlannerDemo.prototype.currentSegmentLength = function () {
    if (!this.state.bestPath || this.state.bestPath.length < 2) {
      return 0;
    }
    return dist(this.state.bestPath[0], this.state.bestPath[1]);
  };

  PlannerDemo.prototype.computeAdaptivePlanWindowMs = function () {
    var s = this.state;
    var speed = Math.max(1e-3, s.autoRobotSpeed);
    var segmentLength = this.currentSegmentLength();
    var minWindowMs = s.autoCycleCount === 0 ? s.autoInitialMinPlanWindowMs : s.autoMinPlanWindowMs;

    var rawMs;
    if (segmentLength > 1e-6) {
      rawMs = (segmentLength / speed) * 1000 * s.autoAdaptiveFactor;
    } else {
      rawMs = s.autoComputedPlanWindowMs > 0 ? s.autoComputedPlanWindowMs : minWindowMs;
    }

    s.autoLastSegmentLength = segmentLength;
    return clamp(rawMs, minWindowMs, s.autoMaxPlanWindowMs);
  };

  PlannerDemo.prototype.startPlanningPhaseWindow = function (now) {
    this.state.autoComputedPlanWindowMs = this.computeAdaptivePlanWindowMs();
    this.state.autoPlanWindowStartTs = now;
    this.state.autoAcceptedAtWindowStart = this.state.accepted;
  };

  PlannerDemo.prototype.startMoveSegment = function (now) {
    var nextNode = null;
    if (this.state.bestPath && this.state.bestPath.length > 1) {
      nextNode = this.state.bestPath[1];
    }
    if (!nextNode) {
      return false;
    }

    var startPose = {
      x: this.state.root.x,
      y: this.state.root.y
    };
    var targetPose = {
      x: nextNode.x,
      y: nextNode.y
    };
    var segmentLength = dist(startPose, targetPose);
    if (segmentLength < 1e-6) {
      return false;
    }

    var speed = Math.max(1e-3, this.state.autoRobotSpeed);
    var moveDurationMs = Math.max(this.minMoveDurationMs, (segmentLength / speed) * 1000);

    this.state.moveActive = true;
    this.state.moveStartTs = now;
    this.state.moveDurationMs = moveDurationMs;
    this.state.moveStartPose = startPose;
    this.state.moveTargetPose = targetPose;
    this.state.moveExecuteNode = nextNode;
    this.state.displayPose = {
      x: startPose.x,
      y: startPose.y
    };
    this.state.autoPhase = 'moving';
    return true;
  };

  PlannerDemo.prototype.updateMoveState = function (now) {
    if (!this.state.moveActive) {
      return false;
    }

    var duration = Math.max(1, this.state.moveDurationMs);
    var t = clamp((now - this.state.moveStartTs) / duration, 0, 1);
    var startPose = this.state.moveStartPose;
    var targetPose = this.state.moveTargetPose;

    this.state.displayPose = {
      x: startPose.x + (targetPose.x - startPose.x) * t,
      y: startPose.y + (targetPose.y - startPose.y) * t
    };

    if (t < 1) {
      return false;
    }

    this.state.moveActive = false;
    if (this.state.autoExecuteDelayMs > 0) {
      this.state.pendingRecycleTs = now + this.state.autoExecuteDelayMs;
    } else {
      this.state.pendingRecycleTs = now;
    }
    return true;
  };

  PlannerDemo.prototype.executeRecycleToNode = function (nextRoot) {
    if (!nextRoot) {
      return false;
    }

    var oldRootCost = nextRoot.cost;
    var oldRootGain = nextRoot.gain;
    var remainingBudget = Math.max(0, this.state.budget - oldRootCost);

    var kept = [];
    for (var i = 0; i < this.state.nodes.length; i++) {
      var node = this.state.nodes[i];
      if (isDescendantOf(node, nextRoot)) {
        kept.push(node);
      }
    }

    if (kept.length === 0) {
      return false;
    }

    nextRoot.parent = null;

    for (var k = 0; k < kept.length; k++) {
      var n = kept[k];
      n.cost = Math.max(0, n.cost - oldRootCost);
      n.gain = Math.max(0, n.gain - oldRootGain);
    }

    this.state.nodes = kept;
    this.state.root = nextRoot;
    this.state.displayPose = { x: nextRoot.x, y: nextRoot.y };
    this.state.budget = remainingBudget;
    this.state.effectiveHorizon = Math.min(this.state.budget, this.state.planningHorizon);
    this.state.closedNodeIds = new Set();
    this.state.samples = 0;
    this.state.accepted = 0;
    this.state.rejected = 0;
    this.state.pruned = 0;
    this.state.plannedSinceRecycle = false;
    this.state.replanCount += 1;
    this.state.executedCost += oldRootCost;
    this.state.pendingRecycleTs = 0;

    var best = kept[0];
    for (var j = 1; j < kept.length; j++) {
      if (kept[j].gain > best.gain) {
        best = kept[j];
      }
    }
    this.state.best = best;
    this.state.bestPath = this.nodePath(best);
    this.applyScenarioEventIfTriggered();
    return true;
  };

  PlannerDemo.prototype.startAutoCycle = function () {
    if (!this.state || this.state.uiMode !== 'auto') {
      return;
    }
    this.stopLoops('');
    this.state.autoRunning = true;
    this.state.autoPhase = 'planning';
    this.state.autoPlanWindowStartTs = 0;
    this.state.autoStallCycles = 0;
    this.state.autoStopReason = '';
    this.state.autoPlanStepCounter = 0;
    this.state.autoComputedPlanWindowMs = this.state.autoInitialMinPlanWindowMs;
    this.state.autoLastSegmentLength = 0;
    this.state.moveActive = false;
    this.state.moveExecuteNode = null;
    this.state.pendingRecycleTs = 0;
    this.state.displayPose = { x: this.state.root.x, y: this.state.root.y };
    this.render();
    this.autoTick();
  };

  PlannerDemo.prototype.stopAutoCycle = function (reason) {
    this.stopLoops(reason || 'Auto stopped.');
  };

  PlannerDemo.prototype.updateWorkflowUI = function () {
    var c = this.controls;
    var isAuto = this.state.uiMode === 'auto';
    var canExecute = this.canExecuteCurrentPlan();
    this.controls.replan.disabled = !canExecute;

    c.manualActions.classList.toggle('planner-demo-hidden', isAuto);
    c.autoControls.classList.toggle('is-visible', isAuto);
    c.modeManual.classList.toggle('is-link', !isAuto);
    c.modeManual.classList.toggle('is-light', isAuto);
    c.modeAuto.classList.toggle('is-link', isAuto);
    c.modeAuto.classList.toggle('is-light', !isAuto);
    c.autoStart.disabled = !isAuto || this.state.autoRunning;
    c.autoStop.disabled = !isAuto || !this.state.autoRunning;
    c.autoStart.classList.toggle('is-success', !this.state.autoRunning);
    c.autoStart.classList.toggle('is-light', this.state.autoRunning);
    c.autoStop.classList.toggle('is-danger', this.state.autoRunning);
    c.autoStop.classList.toggle('is-light', !this.state.autoRunning);
    c.pause.disabled = isAuto;

    if (isAuto) {
      if (this.state.autoRunning) {
        this.hintEl.textContent = 'Auto cycling... click "Stop" to pause.';
      } else if (this.state.autoStopReason) {
        this.hintEl.textContent = this.state.autoStopReason;
      } else {
        this.hintEl.textContent = 'Click "Start" to begin plan -> execute -> recycle cycles.';
      }
      return;
    }

    if (canExecute) {
      this.hintEl.textContent = 'Plan is ready. Click "Execute + Recycle" to advance, then click "Plan" again.';
    } else if (this.state.replanCount > 0) {
      this.hintEl.textContent = 'Recycled at new pose. Click "Plan" to refine before executing again.';
    } else {
      this.hintEl.textContent = 'Click "Plan" (or "Plan Step") to build a plan, then execute.';
    }
  };

  PlannerDemo.prototype.getSeed = function () {
    var seed = Number(this.controls.seed.value);
    if (!Number.isFinite(seed)) {
      seed = 42;
    }
    seed = Math.floor(clamp(seed, 1, 1000000));
    this.controls.seed.value = String(seed);
    if (!this.controls.deterministic.checked) {
      seed = (Date.now() % 1000000) + seed;
    }
    return seed;
  };

  PlannerDemo.prototype.makeBaseMaps = function (scenario, priorsOverride) {
    var priors = scenario.priors;
    if (Array.isArray(priorsOverride) && priorsOverride.length > 0) {
      priors = priorsOverride;
    }
    var baseMap = new Float32Array(this.cellCount);
    var priorityMap = new Float32Array(this.cellCount);
    var mask = new Uint8Array(this.cellCount);

    for (var y = 0; y < this.gridH; y++) {
      for (var x = 0; x < this.gridW; x++) {
        var idx = y * this.gridW + x;
        var cx = x + 0.5;
        var cy = y + 0.5;
        var inside = pointInPolygon(cx, cy, scenario.polygon);
        mask[idx] = inside ? 1 : 0;

        if (!inside) {
          baseMap[idx] = 0.0;
          priorityMap[idx] = 0.0;
          continue;
        }

        var uncertainty = 0.09;
        var priority = 1.0;

        for (var p = 0; p < priors.length; p++) {
          var prior = priors[p];
          var dx = cx - prior.x;
          var dy = cy - prior.y;
          var d2 = dx * dx + dy * dy;
          var gaussian = Math.exp(-d2 / (2 * prior.sigma * prior.sigma));
          uncertainty += prior.gain * gaussian * 0.8;
          priority += prior.priority * gaussian;
        }

        baseMap[idx] = clamp(uncertainty, 0.02, 0.96);
        priorityMap[idx] = clamp(priority, 0.5, 3.5);
      }
    }

    return {
      baseMap: baseMap,
      priorityMap: priorityMap,
      mask: mask
    };
  };

  PlannerDemo.prototype.recomputeTreeBeliefsAndGains = function () {
    var nodes = this.state.nodes;
    if (!nodes || nodes.length === 0) {
      return;
    }

    var root = this.state.root;
    root.parent = null;
    root.cost = 0;
    root.gain = 0;
    root.edgeGain = 0;
    root.vertexGain = 0;
    root.map = this.state.baseMap.slice(0);

    var edgeGainSum = 0;
    for (var i = 1; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.parent || !node.parent.map) {
        continue;
      }
      var parent = node.parent;
      var nextMap = parent.map.slice(0);
      var edgeGain = 0;
      if (this.state.includeEdge) {
        edgeGain = this.applyEdgeObservation(nextMap, parent, node);
      }
      var vertexGain = this.applyObservation(nextMap, node, 1.0, 1.0);

      node.edgeGain = edgeGain;
      node.vertexGain = vertexGain;
      node.map = nextMap;
      node.cost = parent.cost + dist(parent, node) * COST_PER_GRID_UNIT;
      node.gain = parent.gain + edgeGain + vertexGain;
      edgeGainSum += edgeGain;
    }

    this.state.edgeGainTotal = edgeGainSum;
    this.state.best = nodes[0];
    for (var j = 1; j < nodes.length; j++) {
      if (nodes[j].gain > this.state.best.gain) {
        this.state.best = nodes[j];
      }
    }
    this.state.bestPath = this.nodePath(this.state.best);
  };

  PlannerDemo.prototype.applyScenarioEventIfTriggered = function () {
    var s = this.state;
    var scenario = s.scenario;
    if (!scenario || !scenario.eventTrigger || s.eventActive) {
      return false;
    }

    var trigger = scenario.eventTrigger;
    var threshold = Number(trigger.count);
    if (!Number.isFinite(threshold)) {
      threshold = 1;
    }

    var triggered = trigger.type === 'autoCycles'
      ? s.autoCycleCount >= threshold
      : s.replanCount >= threshold;
    if (!triggered) {
      return false;
    }

    var eventPriors = Array.isArray(scenario.eventPriors) ? scenario.eventPriors : scenario.priors;
    var activePriors = scenario.eventMode === 'additive'
      ? scenario.priors.concat(eventPriors)
      : eventPriors.slice(0);

    var maps = this.makeBaseMaps(scenario, activePriors);
    s.activePriors = activePriors;
    s.baseMap = maps.baseMap;
    s.priorityMap = maps.priorityMap;
    s.eventActive = true;
    s.eventLabel = scenario.eventLabelSuffix || 'Event active';

    this.recomputeTreeBeliefsAndGains();
    return true;
  };

  PlannerDemo.prototype.samplePointInsideMask = function () {
    for (var tries = 0; tries < 60; tries++) {
      var x = this.rng() * (this.gridW - 1);
      var y = this.rng() * (this.gridH - 1);
      var idx = (y | 0) * this.gridW + (x | 0);
      if (this.state.mask[idx]) {
        return { x: x, y: y };
      }
    }
    return { x: this.state.root.x, y: this.state.root.y };
  };

  PlannerDemo.prototype.sampleWeightedPoint = function () {
    var map = this.state.best ? this.state.best.map : this.state.baseMap;
    var total = 0;
    var idx;

    for (idx = 0; idx < this.cellCount; idx++) {
      if (!this.state.mask[idx]) {
        continue;
      }
      total += map[idx] * this.state.priorityMap[idx] + 1e-6;
    }

    if (total <= 0) {
      return this.samplePointInsideMask();
    }

    var pick = this.rng() * total;
    var accum = 0;
    var chosen = -1;
    for (idx = 0; idx < this.cellCount; idx++) {
      if (!this.state.mask[idx]) {
        continue;
      }
      accum += map[idx] * this.state.priorityMap[idx] + 1e-6;
      if (accum >= pick) {
        chosen = idx;
        break;
      }
    }

    if (chosen < 0) {
      return this.samplePointInsideMask();
    }

    var cx = chosen % this.gridW;
    var cy = (chosen / this.gridW) | 0;
    return {
      x: clamp(cx + this.rng(), 0, this.gridW - 1),
      y: clamp(cy + this.rng(), 0, this.gridH - 1)
    };
  };

  PlannerDemo.prototype.isEdgeInsideMask = function (from, to) {
    var steps = Math.max(8, Math.ceil(Math.sqrt(dist2(from, to)) * 2));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var x = from.x + (to.x - from.x) * t;
      var y = from.y + (to.y - from.y) * t;
      var xi = x | 0;
      var yi = y | 0;
      if (xi < 0 || xi >= this.gridW || yi < 0 || yi >= this.gridH) {
        return false;
      }
      var idx = yi * this.gridW + xi;
      if (!this.state.mask[idx]) {
        return false;
      }
    }
    return true;
  };

  PlannerDemo.prototype.findNearestNode = function (point, openOnly) {
    var best = null;
    var bestD2 = Infinity;
    for (var i = 0; i < this.state.nodes.length; i++) {
      var node = this.state.nodes[i];
      if (openOnly && this.state.closedNodeIds.has(node.id)) {
        continue;
      }
      var d2 = dist2(node, point);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = node;
      }
    }
    return best;
  };

  PlannerDemo.prototype.applyObservation = function (candidateMap, point, strengthScale, radiusScale) {
    var scenario = this.state.scenario;
    var obsScale = strengthScale === undefined ? 1 : strengthScale;
    var fpScale = radiusScale === undefined ? 1 : radiusScale;
    var radius = scenario.footprint * fpScale;
    var minX = clamp(Math.floor(point.x - radius), 0, this.gridW - 1);
    var maxX = clamp(Math.ceil(point.x + radius), 0, this.gridW - 1);
    var minY = clamp(Math.floor(point.y - radius), 0, this.gridH - 1);
    var maxY = clamp(Math.ceil(point.y + radius), 0, this.gridH - 1);

    var infoGain = 0;
    var radius2 = radius * radius;

    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var dx = (x + 0.5) - point.x;
        var dy = (y + 0.5) - point.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > radius2) {
          continue;
        }

        var idx = y * this.gridW + x;
        if (!this.state.mask[idx]) {
          continue;
        }

        var pOld = candidateMap[idx];
        if (pOld <= 0.0001) {
          continue;
        }

        var radial = 1 - Math.sqrt(d2) / radius;
        var obs = clamp(scenario.obsStrength * obsScale * (0.45 + 0.55 * radial), 0.02, 0.75);
        var pNew = pOld * (1 - obs);
        candidateMap[idx] = pNew;

        var priority = this.state.priorityMap[idx];
        infoGain += (pOld - pNew) * priority;
      }
    }

    return infoGain;
  };

  PlannerDemo.prototype.applyEdgeObservation = function (candidateMap, from, to) {
    var distance = Math.sqrt(dist2(from, to));
    if (distance < 1e-6) {
      return 0;
    }

    var steps = Math.max(2, Math.ceil(distance * 1.6));
    var total = 0;
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var pt = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      };
      total += this.applyObservation(candidateMap, pt, 0.38, 0.70);
    }
    return total;
  };

  PlannerDemo.prototype.nodePath = function (node) {
    var out = [];
    var cur = node;
    while (cur) {
      out.push(cur);
      cur = cur.parent;
    }
    out.reverse();
    return out;
  };

  PlannerDemo.prototype.shouldPruneCandidate = function (candidate) {
    var pruneRadius2 = this.state.pruneRadius * this.state.pruneRadius;
    var epsGain = 0.02;
    var epsCost = 0.05;

    for (var i = 0; i < this.state.nodes.length; i++) {
      var other = this.state.nodes[i];
      if (dist2(other, candidate) > pruneRadius2) {
        continue;
      }
      var dominates =
        other.gain >= candidate.gain + epsGain &&
        other.cost <= candidate.cost - epsCost;
      if (dominates) {
        return true;
      }
    }
    return false;
  };

  PlannerDemo.prototype.getNeighborsWithinRadius = function (point, radius, openOnly) {
    var neighbors = [];
    var radius2 = radius * radius;
    for (var i = 0; i < this.state.nodes.length; i++) {
      var node = this.state.nodes[i];
      if (openOnly && this.state.closedNodeIds.has(node.id)) {
        continue;
      }
      if (dist2(node, point) <= radius2) {
        neighbors.push(node);
      }
    }
    return neighbors;
  };

  PlannerDemo.prototype.tryExtendFromParent = function (parent, targetPoint) {
    var dx = targetPoint.x - parent.x;
    var dy = targetPoint.y - parent.y;
    var directDistance = Math.sqrt(dx * dx + dy * dy);
    if (directDistance < 1e-6) {
      this.state.rejected += 1;
      return null;
    }

    var extend = Math.min(this.state.extendDistance, directDistance);
    var newPoint = {
      x: parent.x + (dx / directDistance) * extend,
      y: parent.y + (dy / directDistance) * extend
    };
    var edgeCost = extend * COST_PER_GRID_UNIT;

    if (!this.isEdgeInsideMask(parent, newPoint)) {
      this.state.rejected += 1;
      return null;
    }

    var newCost = parent.cost + edgeCost;
    if (newCost > this.state.effectiveHorizon) {
      this.state.rejected += 1;
      return null;
    }

    var nextMap = parent.map.slice(0);
    var edgeGain = 0;
    if (this.state.includeEdge) {
      edgeGain = this.applyEdgeObservation(nextMap, parent, newPoint);
    }
    var vertexGain = this.applyObservation(nextMap, newPoint, 1.0, 1.0);
    var deltaGain = edgeGain + vertexGain;

    var nextNode = {
      id: this.state.nextNodeId++,
      x: newPoint.x,
      y: newPoint.y,
      parent: parent,
      cost: newCost,
      gain: parent.gain + deltaGain,
      map: nextMap,
      edgeGain: edgeGain,
      vertexGain: vertexGain
    };

    if (this.shouldPruneCandidate(nextNode)) {
      this.state.pruned += 1;
      return null;
    }

    this.state.nodes.push(nextNode);
    this.state.accepted += 1;
    this.state.edgeGainTotal += edgeGain;
    this.state.plannedSinceRecycle = true;

    if (!this.state.best || nextNode.gain >= this.state.best.gain) {
      this.state.best = nextNode;
      this.state.bestPath = this.nodePath(nextNode);
    }

    return nextNode;
  };

  PlannerDemo.prototype.plannerStep = function () {
    if (this.state.samples >= this.state.maxSamples) {
      return false;
    }

    this.state.samples += 1;

    var sampled = this.sampleWeightedPoint();
    var nearest = this.findNearestNode(sampled, true);
    if (!nearest) {
      this.state.closedNodeIds.clear();
      nearest = this.findNearestNode(sampled, false);
    }
    if (!nearest) {
      return false;
    }
    var firstCandidate = this.tryExtendFromParent(nearest, sampled);
    var feasibleTarget = firstCandidate || sampled;
    this.state.closedNodeIds.add(nearest.id);

    var neighbors = this.getNeighborsWithinRadius(feasibleTarget, this.state.extendRadius, true);
    for (var i = 0; i < neighbors.length; i++) {
      var neighbor = neighbors[i];
      if (neighbor === nearest && firstCandidate) {
        continue;
      }
      if (neighbor === firstCandidate) {
        continue;
      }
      this.tryExtendFromParent(neighbor, feasibleTarget);
      this.state.closedNodeIds.add(neighbor.id);
    }

    return true;
  };

  PlannerDemo.prototype.replanTreeStep = function () {
    if (!this.state.bestPath || this.state.bestPath.length === 0) {
      return;
    }

    var nextRoot = this.state.bestPath.length > 1 ? this.state.bestPath[1] : this.state.bestPath[0];
    this.executeRecycleToNode(nextRoot);
  };

  PlannerDemo.prototype.stepMany = function (count) {
    for (var i = 0; i < count; i++) {
      if (!this.plannerStep()) {
        return false;
      }
    }
    return true;
  };

  PlannerDemo.prototype.tick = function () {
    if (!this.running || this.state.uiMode !== 'manual') {
      return;
    }

    var stillHasBudget = this.stepMany(this.manualSamplesPerFrame);
    this.render();

    if (!stillHasBudget || this.state.samples >= this.state.maxSamples) {
      this.running = false;
      this.rafId = null;
      return;
    }

    var self = this;
    this.rafId = requestAnimationFrame(function () {
      self.tick();
    });
  };

  PlannerDemo.prototype.autoTick = function (timestamp) {
    if (!this.state.autoRunning || this.state.uiMode !== 'auto') {
      return;
    }

    var now = Number.isFinite(timestamp) ? timestamp : performance.now();
    var shouldRender = false;

    this.updateMoveState(now);
    if (this.state.moveActive) {
      // Keep robot motion visually smooth even when tree updates are batched.
      shouldRender = true;
    }
    if (this.state.pendingRecycleTs && now >= this.state.pendingRecycleTs) {
      if (!this.executeRecycleToNode(this.state.moveExecuteNode)) {
        this.stopAutoCycle('Stopped: failed to recycle moved segment.');
        this.render();
        return;
      }
      this.state.autoCycleCount += 1;
      this.state.moveExecuteNode = null;
      this.state.autoPhase = 'planning';
      this.state.autoPlanWindowStartTs = 0;

      if (this.state.budget <= 1e-6 || this.state.effectiveHorizon <= 1e-6) {
        this.stopAutoCycle('Stopped: remaining budget/horizon exhausted.');
        this.render();
        return;
      }
      shouldRender = true;
    }

    if (!this.state.moveActive && !this.state.pendingRecycleTs && this.canExecuteCurrentPlan()) {
      if (this.startMoveSegment(now)) {
        shouldRender = true;
      }
    }

    if (!this.state.autoPlanWindowStartTs) {
      this.startPlanningPhaseWindow(now);
    }

    var planningDeadline = this.state.autoPlanWindowStartTs + this.state.autoComputedPlanWindowMs;
    var planningSliceMs = this.state.moveActive ? this.autoPlanningSliceMovingMs : this.autoPlanningSliceMs;
    var sliceEnd = Math.min(performance.now() + planningSliceMs, planningDeadline);
    var stepsThisTick = 0;
    while (performance.now() < sliceEnd) {
      var ok = this.plannerStep();
      stepsThisTick += 1;
      this.state.autoPlanStepCounter += 1;
      if (!ok) {
        break;
      }
    }

    var planningWindowDone = performance.now() >= planningDeadline;
    if (planningWindowDone) {
      var acceptedDelta = this.state.accepted - this.state.autoAcceptedAtWindowStart;
      if (!this.canExecuteCurrentPlan()) {
        if (acceptedDelta <= 0) {
          this.state.autoStallCycles += 1;
        } else {
          this.state.autoStallCycles = 0;
        }
        if (this.state.autoStallCycles >= this.state.autoStallLimit) {
          this.stopAutoCycle('Stopped: planner stalled without finding an executable step.');
          this.render();
          return;
        }
        if (this.state.samples >= this.state.maxSamples) {
          this.stopAutoCycle('Stopped: max samples reached with no valid execute step.');
          this.render();
          return;
        }
        this.startPlanningPhaseWindow(now);
      } else {
        this.state.autoStallCycles = 0;
        this.startPlanningPhaseWindow(now);
      }
    }

    if (stepsThisTick > 0 && this.state.autoPlanStepCounter % this.autoRenderEveryN === 0) {
      shouldRender = true;
    }

    if (shouldRender) {
      this.render();
    }

    if (!this.state.autoRunning || this.state.uiMode !== 'auto') {
      this.rafId = null;
      return;
    }

    var self = this;
    this.rafId = requestAnimationFrame(function (ts) {
      self.autoTick(ts);
    });
  };

  PlannerDemo.prototype.reset = function () {
    this.stopLoops('');

    var scenarioKey = this.controls.scenario.value || 'wideAreaCoverage';
    var baseScenario = this.scenarios[scenarioKey];
    var scenario = {
      label: baseScenario.label,
      polygon: baseScenario.polygon,
      start: baseScenario.start,
      footprint: Number(this.controls.footprint.value),
      obsStrength: Number(this.controls.obsStrength.value),
      priors: baseScenario.priors,
      eventTrigger: baseScenario.eventTrigger,
      eventMode: baseScenario.eventMode,
      eventPriors: baseScenario.eventPriors,
      eventLabelSuffix: baseScenario.eventLabelSuffix
    };

    this.seed = this.getSeed();
    this.rng = mulberry32(this.seed);

    var activePriors = scenario.priors.slice(0);
    var maps = this.makeBaseMaps(scenario, activePriors);

    var rootMap = maps.baseMap.slice(0);
    var rootNode = {
      id: 0,
      x: scenario.start.x,
      y: scenario.start.y,
      parent: null,
      cost: 0,
      gain: 0,
      map: rootMap
    };

    this.state = {
      scenario: scenario,
      scenarioKey: scenarioKey,
      mask: maps.mask,
      priorityMap: maps.priorityMap,
      baseMap: maps.baseMap,
      activePriors: activePriors,
      eventActive: false,
      eventLabel: '',
      root: rootNode,
      nodes: [rootNode],
      best: rootNode,
      bestPath: [rootNode],
      closedNodeIds: new Set(),
      nextNodeId: 1,
      budget: Number(this.controls.budget.value),
      planningHorizon: Number(this.controls.planningHorizon.value),
      maxSamples: Number(this.controls.maxSamples.value),
      extendDistance: Number(this.controls.extendDistance.value),
      extendRadius: Number(this.controls.extendRadius.value),
      pruneRadius: Number(this.controls.pruneRadius.value),
      includeEdge: this.controls.includeEdge.checked,
      samples: 0,
      accepted: 0,
      rejected: 0,
      pruned: 0,
      edgeGainTotal: 0,
      replanCount: 0,
      executedCost: 0,
      plannedSinceRecycle: false,
      uiMode: this.uiMode,
      autoRunning: false,
      autoPhase: 'planning',
      autoCycleCount: 0,
      autoPlanStepCounter: 0,
      autoRobotSpeed: Number(this.controls.autoSpeed.value),
      autoMaxPlanWindowMs: Number(this.controls.autoMaxPlanTime.value) * 1000,
      autoInitialMinPlanWindowMs: 2000,
      autoMinPlanWindowMs: 300,
      autoAdaptiveFactor: 1.0,
      autoComputedPlanWindowMs: 1200,
      autoLastSegmentLength: 0,
      autoPlanWindowStartTs: 0,
      autoExecuteDelayMs: Number(this.controls.autoExecDelay.value) * 1000,
      autoAcceptedAtWindowStart: 0,
      autoStallCycles: 0,
      autoStallLimit: 3,
      autoStopReason: '',
      moveActive: false,
      moveStartTs: 0,
      moveDurationMs: 0,
      moveStartPose: { x: scenario.start.x, y: scenario.start.y },
      moveTargetPose: { x: scenario.start.x, y: scenario.start.y },
      moveExecuteNode: null,
      pendingRecycleTs: 0,
      displayPose: { x: scenario.start.x, y: scenario.start.y }
    };
    this.state.effectiveHorizon = Math.min(this.state.budget, this.state.planningHorizon);

    this.render();
  };

  PlannerDemo.prototype.drawMap = function () {
    var ctx = this.ctx;
    var cw = this.canvas.width;
    var ch = this.canvas.height;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#f4f6f9';
    ctx.fillRect(0, 0, cw, ch);

    var pad = 8;
    var worldW = cw - pad * 2;
    var worldH = ch - pad * 2;
    var cellW = worldW / this.gridW;
    var cellH = worldH / this.gridH;

    this.layout = {
      pad: pad,
      worldW: worldW,
      worldH: worldH,
      cellW: cellW,
      cellH: cellH
    };

    var map = this.state.best ? this.state.best.map : this.state.baseMap;

    for (var y = 0; y < this.gridH; y++) {
      for (var x = 0; x < this.gridW; x++) {
        var idx = y * this.gridW + x;

        if (!this.state.mask[idx]) {
          ctx.fillStyle = '#f4f6f9';
        } else {
          var v = clamp(map[idx], 0, 1);
          var hue = 220 + 115 * v;
          var sat = 62 + 30 * v;
          var light = 96 - 52 * v;
          ctx.fillStyle = 'hsl(' + hue.toFixed(0) + ', ' + sat.toFixed(0) + '%, ' + light.toFixed(0) + '%)';
        }

        ctx.fillRect(
          pad + x * cellW,
          pad + y * cellH,
          Math.ceil(cellW) + 1,
          Math.ceil(cellH) + 1
        );
      }
    }

    var poly = this.state.scenario.polygon;
    ctx.beginPath();
    for (var i = 0; i < poly.length; i++) {
      var px = pad + poly[i][0] * cellW;
      var py = pad + poly[i][1] * cellH;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(24, 38, 58, 0.85)';
    ctx.stroke();
  };

  PlannerDemo.prototype.drawTree = function () {
    var ctx = this.ctx;
    var l = this.layout;

    function toCanvas(node) {
      return {
        x: l.pad + node.x * l.cellW,
        y: l.pad + node.y * l.cellH
      };
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(40, 70, 120, 0.22)';
    ctx.beginPath();
    for (var i = 1; i < this.state.nodes.length; i++) {
      var n = this.state.nodes[i];
      var p = toCanvas(n);
      var q = toCanvas(n.parent);
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.95)';
    ctx.beginPath();
    for (var k = 1; k < this.state.bestPath.length; k++) {
      var a = toCanvas(this.state.bestPath[k - 1]);
      var b = toCanvas(this.state.bestPath[k]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    var poseNode = this.state.displayPose || this.state.root;
    var start = toCanvas(poseNode);
    ctx.beginPath();
    ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#20c8d8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0b5f79';
    ctx.stroke();

    ctx.fillStyle = '#0b5f79';
    ctx.font = '12px Google Sans, sans-serif';
    ctx.fillText('Current Pose', start.x + 10, start.y - 8);

    if (this.state.best) {
      var best = toCanvas(this.state.best);
      ctx.beginPath();
      ctx.arc(best.x, best.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9f1c';
      ctx.fill();
      ctx.fillStyle = '#9a5d00';
      ctx.font = '11px Google Sans, sans-serif';
      ctx.fillText('Best', best.x + 8, best.y + 12);
    }
  };

  PlannerDemo.prototype.drawLegend = function () {
    var ctx = this.ctx;
    var cw = this.canvas.width;
    var y = this.canvas.height - 26;

    var grad = ctx.createLinearGradient(cw - 230, 0, cw - 30, 0);
    grad.addColorStop(0, 'hsl(220, 62%, 90%)');
    grad.addColorStop(1, 'hsl(330, 92%, 48%)');

    ctx.fillStyle = grad;
    ctx.fillRect(cw - 230, y - 10, 180, 8);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.strokeRect(cw - 230, y - 10, 180, 8);

    ctx.fillStyle = '#2a3b51';
    ctx.font = '11px Google Sans, sans-serif';
    ctx.fillText('low belief', cw - 232, y + 12);
    ctx.fillText('high belief', cw - 98, y + 12);
  };

  PlannerDemo.prototype.updateStatus = function () {
    var s = this.state;
    var bestGain = s.best ? s.best.gain : 0;
    var bestCost = s.best ? s.best.cost : 0;
    var budgetDistance = s.budget / COST_PER_GRID_UNIT;
    var padInt = function (value, width) {
      return String(Math.max(0, Math.floor(value))).padStart(width, ' ');
    };
    var padFixed = function (value, decimals, width) {
      return Number(value).toFixed(decimals).padStart(width, ' ');
    };
    var samplesStr = padInt(s.samples, 4) + ' / ' + padInt(s.maxSamples, 4);
    var acceptedStr = padInt(s.accepted, 5);
    var rejectedStr = padInt(s.rejected, 5);
    var prunedStr = padInt(s.pruned, 5);
    var closedStr = padInt(s.closedNodeIds.size, 4);
    var bestGainStr = padFixed(bestGain, 2, 6);
    var bestCostStr = padFixed(bestCost, 1, 5);
    var horizonStr = padFixed(s.effectiveHorizon, 1, 5);
    var budgetStr = padFixed(s.budget, 1, 5);
    var budgetDistanceStr = padFixed(budgetDistance, 1, 4);
    var modeSummary = s.uiMode === 'auto'
      ? ('Mode: Auto ' + ' | Cycle: ' + padInt(s.autoCycleCount, 3) + ' | Auto: ' + (s.autoRunning ? 'Running' : 'Idle'))
      : 'Mode: Manual';
    var autoDetail = '';
    if (s.uiMode === 'auto') {
      autoDetail =
        ' | Plan time window: ' + padFixed(s.autoComputedPlanWindowMs / 1000, 1, 4) + 's' +
        ' (segment ' + padFixed(s.autoLastSegmentLength, 2, 5) +
        ' / speed ' + padFixed(s.autoRobotSpeed, 1, 3) + ')';
    }
    var eventDetail = s.eventActive ? (' | ' + (s.eventLabel || 'Event active')) : '';

    if (this.controls.modeChip) {
      this.controls.modeChip.textContent = modeSummary + (s.eventActive ? ' | Event active' : '');
    }

    this.statusEl.textContent =
      modeSummary +
      ' | ' +
      'Samples: ' + samplesStr +
      ' | Accepted: ' + acceptedStr +
      ' | Rejected: ' + rejectedStr +
      ' | Pruned: ' + prunedStr +
      ' | Closed: ' + closedStr +
      '\nBest gain: ' + bestGainStr +
      ' | Best cost: ' + bestCostStr + ' / ' + horizonStr +
      autoDetail +
      eventDetail;
  };

  PlannerDemo.prototype.render = function () {
    this.drawMap();
    this.drawTree();
    this.drawLegend();
    this.updateStatus();
    this.updateWorkflowUI();
  };

  function getRootElements() {
    return {
      canvas: document.getElementById('planner-demo-canvas'),
      status: document.getElementById('planner-demo-status'),
      hint: document.getElementById('demo-workflow-hint'),
      controls: {
        scenario: document.getElementById('demo-scenario'),
        modeChip: document.getElementById('demo-mode-chip'),
        modeManual: document.getElementById('demo-mode-manual'),
        modeAuto: document.getElementById('demo-mode-auto'),
        manualActions: document.getElementById('demo-manual-actions'),
        autoControls: document.getElementById('demo-auto-controls'),
        autoStart: document.getElementById('demo-auto-start'),
        autoStop: document.getElementById('demo-auto-stop'),
        autoSpeed: document.getElementById('demo-auto-speed'),
        autoSpeedValue: document.getElementById('demo-auto-speed-value'),
        autoMaxPlanTime: document.getElementById('demo-auto-max-plan-time'),
        autoMaxPlanTimeValue: document.getElementById('demo-auto-max-plan-time-value'),
        autoExecDelay: document.getElementById('demo-auto-exec-delay'),
        autoExecDelayValue: document.getElementById('demo-auto-exec-delay-value'),
        budget: document.getElementById('demo-budget'),
        budgetValue: document.getElementById('demo-budget-value'),
        planningHorizon: document.getElementById('demo-planning-horizon'),
        planningHorizonValue: document.getElementById('demo-planning-horizon-value'),
        maxSamples: document.getElementById('demo-max-samples'),
        maxSamplesValue: document.getElementById('demo-max-samples-value'),
        footprint: document.getElementById('demo-footprint'),
        footprintValue: document.getElementById('demo-footprint-value'),
        obsStrength: document.getElementById('demo-obs-strength'),
        obsStrengthValue: document.getElementById('demo-obs-strength-value'),
        extendDistance: document.getElementById('demo-extend-distance'),
        extendDistanceValue: document.getElementById('demo-extend-distance-value'),
        extendRadius: document.getElementById('demo-extend-radius'),
        extendRadiusValue: document.getElementById('demo-extend-radius-value'),
        pruneRadius: document.getElementById('demo-prune-radius'),
        pruneRadiusValue: document.getElementById('demo-prune-radius-value'),
        seed: document.getElementById('demo-seed'),
        deterministic: document.getElementById('demo-deterministic'),
        includeEdge: document.getElementById('demo-include-edge'),
        run: document.getElementById('demo-run'),
        pause: document.getElementById('demo-pause'),
        step: document.getElementById('demo-step'),
        replan: document.getElementById('demo-replan'),
        reset: document.getElementById('demo-reset')
      }
    };
  }

  window.initPlannerDemo = function () {
    var root = getRootElements();
    if (!root.canvas || !root.status || !root.hint || !root.controls.scenario ||
      !root.controls.modeManual || !root.controls.modeAuto ||
      !root.controls.autoStart || !root.controls.autoStop ||
      !root.controls.autoSpeed || !root.controls.autoMaxPlanTime ||
      !root.controls.autoExecDelay ||
      !root.controls.footprint || !root.controls.obsStrength) {
      return;
    }

    if (!window.__plannerDemoInstance) {
      window.__plannerDemoInstance = new PlannerDemo(root);
    }
  };
})();
