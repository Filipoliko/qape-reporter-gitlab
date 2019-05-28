# QApe Reporter Gitlab
This is reporter for [QApe](https://www.npmjs.com/package/qape). It can report all the errors he finds to gitlab issue tracker.

## Installation
Add reporter as a dependency
```
npm install qape-reporter-gitlab
```
Update QApe config
```javascript
export default {
	...
	reporters: ['gitlab'],
	reporterOptions: {
		gitlab: {
			url: 'https://gitlab.com'
			projectId: 1,
			privateToken: 'private_token', // Gitlab private token to access gitlab API
			assignees: ['username', 1] // (Optional) Gitlab username or user id
		}
	}
}
```
