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

	async _handleScenarioEnd(eventData) {
		if (eventData.type === 'failing' &&
			eventData.minified &&
			!this._isFailureReported(eventData.scenario)
		) {
			let { scenario, errors } = eventData;

			this._results.push({ scenario, errors });

			this._getIssueWithSameError(errors)
				.then(issueId => {
					this._postGitlabIssue(scenario, errors, issueId);
				})
		}
	}

	_getIssueWithSameError(errors) {
		return new Promise(resolve => {
			request({
				url: `${this._reporterOptions.url}/api/v4/projects/${this._reporterOptions.projectId}/issues?state=opened&labels=QApe`,
				headers: {
					'PRIVATE-TOKEN': this._reporterOptions.privateToken
				}
			}, (error, response, body) => {
				if (!body || error || (response && (response.statusCode !== 200))) {
					console.error('Unable to get issues from gitlab, duplicate issue might be created.')
					resolve();
					return;
				}

				let issues = JSON.parse(body);

				for (let issue of issues) {
					for (let err of errors) {
						if (issue.description && issue.description.includes(err.error)) {
							resolve(issue.iid);
							return;
						}
					}
				}

				resolve();
			});
		});
	}

	_isFailureReported(scenario) {
		return !!this._results.find(result => isEqual(result.scenario, scenario));
	}

	_postGitlabIssue(scenario, errors, issueId) {
		let url = issueId ?
			`${this._reporterOptions.url}/api/v4/projects/${this._reporterOptions.projectId}/issues/${issueId}/notes`
		:
			`${this._reporterOptions.url}/api/v4/projects/${this._reporterOptions.projectId}/issues`;

		request.post({
			method: 'POST',
			url,
			headers: {
				'PRIVATE-TOKEN': this._reporterOptions.privateToken
			},
			json: true,
			body: this._getGitlabRequestBody(scenario, errors, issueId)
		}, (error, response) => {
			if (error) {
				return console.error(error);
			}

			if (response && response.statusCode !== 201) {
				return console.error(`Recieved wrong status code ${response.statusCode}`);
			}

			if (issueId) {
				console.log(`Gitlab: Added comment to issue id ${issueId} containing more info on the error.`);
			} else {
				console.log('Gitlab: Issue successfully created.');
			}
		});
	}

	_getGitlabRequestBody(scenario, errors, issueId) {
		if (issueId) {
			return {
				body: 'QApe found another scenario, which leads to the following error:\n\n' +
					'```\n' +
					JSON.stringify(errors, null, '\t') +
					'\n```' +
					'\n\nFollowing scenario reproduces the error:\n\n' +
					this._getScenarioReadable(scenario) +
					'\n\nJSON:\n\n' +
					this._getScenarioJSON(scenario, errors)
				};
		}

		return {
			title: `QApe_${new Date().getTime()}`,
			description: 'QApe found a scenario, which leads to the following error:\n\n' +
				'```\n' +
				JSON.stringify(errors, null, '\t') +
				'\n```' +
				'\n\nFollowing scenario reproduces the error:\n\n' +
				this._getScenarioReadable(scenario) +
				'\n\nJSON:\n\n' +
				this._getScenarioJSON(scenario, errors),
			labels: 'QApe'
		};
	}

	_getScenarioReadable(scenario) {
		return `- Go to ${scenario[0].beforeLocation}\n` + scenario
			.map(step => (`- ${step.message}`))
			.join('\n');
	}

	_getScenarioJSON(scenario, errors) {
		return '```\n' +
			JSON.stringify({ errors, scenario }, null, '\t') +
			'\n```';
	}
}

exports.default = GitlabReporter;
