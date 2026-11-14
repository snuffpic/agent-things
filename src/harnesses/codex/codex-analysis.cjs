'use strict';
const { AnalysisService } = require('../../analysis-service.cjs');
const { AnalysisAppServer } = require('../../analysis-app-server.cjs');
const { runAnalysis } = require('../../analysis-runner.cjs');

function createCodexAnalysis(options) {
  return new AnalysisService({ ...options, makeServer: settings => new AnalysisAppServer(settings), run: runAnalysis });
}

module.exports = { createCodexAnalysis };
