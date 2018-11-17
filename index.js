const EventEmitter = require('events');
const request = require('request');
const isEqual = require('lodash.isequal');

class GitlabReporter extends EventEmitter {
	constructor(config) {
		super();

		this._config = config;

		this._results = [];

		this._reporterOptions = this._config.reporterOptions && this._config.reporterOptions.gitlab;

		if (!this._reporterOptions ||
			!this._reporterOptions.projectId ||
			!this._reporterOptions.url ||
			!this._reporterOptions.privateToken
		) {
			throw Error('There are missing reporter options for gitlab reporter. Please update your config according to documentation.');
		}

		this.on('scenario:end', eventData => this._handleScenarioEnd(eventData));
	}

	_handleScenarioEnd(eventData) {
		if (eventData.type === 'failing' &&
			eventData.minified &&
			!this._isFailureReported(eventData.scenario)
		) {
			let { scenario, errors } = eventData;

			this._results.push({ scenario, errors });

			this._postGitlabIssue(scenario, errors);
		}
	}

	_isFailureReported(scenario) {
		return !!this._results.find(result => isEqual(result.scenario, scenario));
	}

	_postGitlabIssue(scenario, errors) {
		request.post({
			method: 'POST',
			url: `${this._reporterOptions.url}/api/v4/projects/${this._reporterOptions.projectId}/issues`,
			headers: {
				'PRIVATE-TOKEN': this._reporterOptions.privateToken
			},
			json: true,
			body: this._getGitlabRequestBody(scenario, errors)
		}, (error, response) => {
			if (error) {
				return console.error(error);
			}

			if (response && response.statusCode !== 201) {
				return console.error(`Recieved wrong status code ${response.statusCode}`);
			}

			console.log('Gitlab Issue successfully created.');
		});
	}

	_getGitlabRequestBody(scenario, errors) {
		return {
			title: `QApe_${new Date().getTime()}`,
			description: 'QApe found a scenario, which leads to following error:\n\n' +
				'```\n' +
				JSON.stringify(errors, null, '\t') +
				'\n```' +
				'\n\nFollowing scenario reproduces the error:\n\n' +
				this._getScenarioReadable(scenario) +
				'\n\nJSON:\n\n' +
				this._getScenarioJSON(scenario, errors),
			labels: 'QApe'
		}
	}

	_getScenarioReadable(scenario) {
		return scenario
			.map(step => (`- ${step.message}`))
			.join('\n');
	}

	_getScenarioJSON(scenario, errors) {
		return '```\n' +
			JSON.stringify({ errors, scenario }, null, '\t') +
			'\n```';
	}
}

module.exports = { GitlabReporter };
