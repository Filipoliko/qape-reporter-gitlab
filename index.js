const EventEmitter = require('events');
const request = require('request');
const isEqual = require('lodash.isequal');

class GitlabReporter extends EventEmitter {
	constructor(config) {
		super();

		this._config = config;

		this._reporterOptions = this._config.reporterOptions && this._config.reporterOptions.gitlab || {};

		this._results = [];
	}

	async init() {
		this._reporterOptions = await this._getParsedOptions(this._reporterOptions);

		this.on('scenario:end', eventData => this._handleScenarioEnd(eventData));
	}

	async _getParsedOptions(options) {
		if (!options ||
			!options.projectId ||
			!options.url ||
			!options.privateToken
		) {
			throw Error('GitlabReporter: There are missing reporter options. Please update your config according to documentation.');
		}

		await this._testGitlabOptions();

		if (options.assignees) {
			options.assignees = await this._resolveAssignees(options);
		}

		return options;
	}

	_testGitlabOptions() {
		return new Promise((resolve, reject) => {
			let options = this._getProjectUrlOptions('/');

			request(options, (error, response) => {
				if (error || (response && (response.statusCode !== 200))) {
					console.error(`GitlabReporter: Testing gitlab request for url ${options.url}. Check reporter options.`);
					console.error(error || `Recieved wrong status code ${response.statusCode}.`);
					reject();
					return;
				}

				resolve();
			});
		});
	}

	async _resolveAssignees(options) {
		let assignees = [];

		if (Array.isArray(options.assignees)) {
			for (let assignee of options.assignees) {
				if (typeof assignee === 'string') {
					assignee = (await this._getUserId(assignee));
				}

				assignees.push(assignee);
			}
		} else {
			throw Error('GitlabReporter: Option assignees must be an array of usernames or user ids.')
		}

		return assignees;
	}

	async _getUserId(username) {
		let user = await new Promise((resolve, reject) => {
			request({
				url: `${this._reporterOptions.url}/api/v4/users?username=${username}`,
				headers: {
					'PRIVATE-TOKEN': this._reporterOptions.privateToken
				}
			}, (error, response, body) => {
				if (error || (response && (response.statusCode !== 200))) {
					console.error(`Unable to load user with username ${username} from gitlab.`);
					console.error(error || `Recieved wrong status code ${response.statusCode}.`);
					reject();
					return;
				}

				resolve(JSON.parse(body)[0]);
			});
		});

		return user.id;
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

	_getProjectUrlOptions(url) {
		return {
			url: `${this._reporterOptions.url}/api/v4/projects/${this._reporterOptions.projectId}${url}`,
			headers: {
				'PRIVATE-TOKEN': this._reporterOptions.privateToken
			}
		}
	}

	_getIssueWithSameError(errors) {
		return new Promise(resolve => {
			request(this._getProjectUrlOptions('/issues?state=opened&labels=QApe'), (error, response, body) => {
				if (!body || error || (response && (response.statusCode !== 200))) {
					console.error('Unable to get issues from gitlab, duplicate issue might be created.')
					resolve();
					return;
				}

				let issues = JSON.parse(body);
				let escapedErrors = errors.map(({ error }) => error.replace(/\n/g, '\\n'));

				for (let issue of issues) {
					for (let err of escapedErrors) {
						if (issue.description && issue.description.includes(err)) {
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
		let url = issueId ? `/issues/${issueId}/notes` : '/issues';

		request.post(Object.assign({}, this._getProjectUrlOptions(url), {
			method: 'POST',
			json: true,
			body: this._getGitlabRequestBody(scenario, errors, issueId)
		}), (error, response) => {
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
			labels: 'QApe',
			assignee_ids: this._reporterOptions.assignees
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
