'use strict'
/* globals describe it beforeEach afterEach */

let nock = require('nock')
let Heroku = require('heroku-client')
let cli = require('..')
let os = require('os')

let proxyquire = require('proxyquire').noCallThru()
let sinon = require('sinon')
let expect = require('unexpected')
let {PromptMaskError} = require('../lib/prompt.js')

let stubPrompt
let stubOpen
let auth

let machines
let stubNetrc = class {
  constructor () {
    this.machines = machines = {
      'api.heroku.com': {},
      'git.heroku.com': {}
    }
  }

  save () {
    this.saved = true
  }
}

describe('auth', function () {
  beforeEach(() => {
    stubPrompt = sinon.stub()
    stubPrompt.throws('not stubbed')

    stubOpen = sinon.stub()
    stubOpen.throws('not stubbed')
    auth = proxyquire('../lib/auth', {
      'netrc-parser': stubNetrc,
      './prompt': {
        prompt: stubPrompt,
        PromptMaskError: PromptMaskError
      },
      './open': stubOpen
    })

    cli.mockConsole()
    cli.heroku = new Heroku()

    nock.disableNetConnect()

    delete process.env['HEROKU_ORGANIZATION']
    delete process.env['SSO_URL']
  })

  afterEach(() => {
    delete process.env['HEROKU_ORGANIZATION']
    delete process.env['SSO_URL']
  })

  it('logs in via username and password', function () {
    stubPrompt.withArgs('Email').returns(Promise.resolve('email'))
    stubPrompt.withArgs('Password', {hide: true}).returns(Promise.resolve('password'))

    let body = {
      'scope': ['global'],
      'expires_in': 31536000
    }

    let headers = {Authorization: 'Basic ZW1haWw6cGFzc3dvcmQ='}

    let response = {access_token: {token: 'token'}, user: {email: 'foo@bar.com'}}
    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .post('/oauth/authorizations', body)
      .reply(200, response)
    return auth.login()
      .then((data) => {
        expect(data, 'to equal', {token: response.access_token.token, email: response.user.email})
        expect(cli.stderr, 'to equal', '')
        expect(cli.stdout, 'to equal', 'Enter your Heroku credentials:\n')
        api.done()
      })
  })

  it('logs in with oauth token expires_in set', function () {
    stubPrompt.withArgs('Email').returns(Promise.resolve('email'))
    stubPrompt.withArgs('Password', {hide: true}).returns(Promise.resolve('password'))

    let body = {
      'scope': ['global'],
      'expires_in': 60 // seconds
    }

    let headers = {Authorization: 'Basic ZW1haWw6cGFzc3dvcmQ='}

    let response = {access_token: {token: 'token', expires_in: 60}, user: {email: 'foo@bar.com'}}
    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .post('/oauth/authorizations', body)
      .reply(200, response)
    return auth.login({expires_in: 60})
      .then((data) => {
        expect(data, 'to equal', {token: response.access_token.token, email: response.user.email, expires_in: response.access_token.expires_in})
        expect(cli.stderr, 'to equal', '')
        expect(cli.stdout, 'to equal', 'Enter your Heroku credentials:\n')
        api.done()
      })
  })

  it('logs in and saves', function () {
    stubPrompt.withArgs('Email').returns(Promise.resolve('email'))
    stubPrompt.withArgs('Password', {hide: true}).returns(Promise.resolve('password'))

    let body = {
      'scope': ['global'],
      'expires_in': 31536000
    }

    let headers = {Authorization: 'Basic ZW1haWw6cGFzc3dvcmQ='}

    let response = {access_token: {token: 'token'}, user: {email: 'foo@bar.com'}}
    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .post('/oauth/authorizations', body)
      .reply(200, response)
    return auth.login({save: true})
      .then((data) => {
        expect(data, 'to equal', {token: response.access_token.token, email: response.user.email})
        expect(cli.stderr, 'to equal', '')
        expect(cli.stdout, 'to equal', 'Enter your Heroku credentials:\n')
        expect(machines['api.heroku.com'], 'to equal', {login: 'foo@bar.com', password: 'token'})
        expect(machines['git.heroku.com'], 'to equal', {login: 'foo@bar.com', password: 'token'})
        api.done()
      })
  })

  it('throws error when not http error body', function () {
    stubPrompt.withArgs('Email').returns(Promise.resolve('email'))
    stubPrompt.withArgs('Password', {hide: true}).returns(Promise.resolve('password'))

    let body = {
      'scope': ['global'],
      'expires_in': 31536000
    }

    let headers = {Authorization: 'Basic ZW1haWw6cGFzc3dvcmQ='}

    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .post('/oauth/authorizations', body)
      .reply(200, {})
    return expect(auth.login(), 'to be rejected with', "Cannot read property 'token' of undefined")
      .then(() => api.done())
  })

  it('logs in via sso env var', function () {
    let url = 'https://sso.foobar.com/saml/myorg/init?cli=true'
    process.env['SSO_URL'] = url

    let urlStub = stubOpen.withArgs(url).returns(Promise.resolve(undefined))

    let tokenStub = stubPrompt.withArgs('Enter your access token (typing will be hidden)', {hide: true}).returns(Promise.resolve('token'))
    let headers = {Authorization: 'Bearer token'}

    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .get('/account')
      .reply(200, {email: 'foo@bar.com'})

    return auth.login({sso: true})
      .then((auth) => {
        expect(urlStub.called, 'to equal', true)
        expect(tokenStub.called, 'to equal', true)
        expect(cli.stderr, 'to equal', 'Opening browser for login... done\n')
        api.done()
        expect(auth, 'to equal', {token: 'token', email: 'foo@bar.com'})
      })
  })

  it('logs in via sso org env', function () {
    process.env['HEROKU_ORGANIZATION'] = 'myorg'

    let url = 'https://sso.heroku.com/saml/myorg/init?cli=true'
    let urlStub = stubOpen.withArgs(url).returns(Promise.resolve(undefined))

    let tokenStub = stubPrompt.withArgs('Enter your access token (typing will be hidden)', {hide: true}).returns(Promise.resolve('token'))
    let headers = {Authorization: 'Bearer token'}

    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .get('/account')
      .reply(200, {email: 'foo@bar.com'})

    return auth.login({sso: true})
      .then((auth) => {
        expect(urlStub.called, 'to equal', true)
        expect(tokenStub.called, 'to equal', true)
        expect(cli.stderr, 'to equal', 'Opening browser for login... done\n')
        api.done()
        expect(auth, 'to equal', {token: 'token', email: 'foo@bar.com'})
      })
  })

  it('logs in via sso org prompt', function () {
    let orgStub = stubPrompt.withArgs('Enter your organization name').returns(Promise.resolve('myorg'))

    let url = 'https://sso.heroku.com/saml/myorg/init?cli=true'
    let urlStub = stubOpen.withArgs(url).returns(Promise.resolve(undefined))

    let tokenStub = stubPrompt.withArgs('Enter your access token (typing will be hidden)', {hide: true}).returns(Promise.resolve('token'))
    let headers = {Authorization: 'Bearer token'}

    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .get('/account')
      .reply(200, {email: 'foo@bar.com'})

    return auth.login({sso: true})
      .then((auth) => {
        expect(orgStub.called, 'to equal', true)
        expect(urlStub.called, 'to equal', true)
        expect(tokenStub.called, 'to equal', true)
        expect(cli.stderr, 'to equal', 'Opening browser for login... done\n')
        api.done()
        expect(auth, 'to equal', {token: 'token', email: 'foo@bar.com'})
      })
  })

  it('unauthorized token', function () {
    let orgStub = stubPrompt.withArgs('Enter your organization name').returns(Promise.resolve('myorg'))

    let url = 'https://sso.heroku.com/saml/myorg/init?cli=true'
    let urlStub = stubOpen.withArgs(url).returns(Promise.resolve(undefined))

    let tokenStub = stubPrompt.withArgs('Enter your access token (typing will be hidden)', {hide: true}).returns(Promise.resolve('token'))
    let headers = {Authorization: 'Bearer token'}

    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .get('/account')
      .reply(403, {message: 'api message'})

    return expect(auth.login({sso: true}), 'to be rejected with', {body: {message: 'api message'}})
      .then(() => {
        expect(orgStub.called, 'to equal', true)
        expect(urlStub.called, 'to equal', true)
        expect(tokenStub.called, 'to equal', true)
        expect(cli.stderr, 'to equal', 'Opening browser for login... done\n')
        api.done()
      })
  })

  it('logs in via sso org prompt when cannot open', function () {
    let orgStub = stubPrompt.withArgs('Enter your organization name').returns(Promise.resolve('myorg'))

    let url = 'https://sso.heroku.com/saml/myorg/init?cli=true'
    let urlStub = stubOpen.withArgs(url).returns(Promise.reject(new Error('cannot open')))

    let tokenStub = stubPrompt.withArgs('Enter your access token (typing will be hidden)', {hide: true}).returns(Promise.resolve('token'))
    let headers = {Authorization: 'Bearer token'}

    let api = nock('https://api.heroku.com', {reqheaders: headers})
      .get('/account')
      .reply(200, {email: 'foo@bar.com'})

    return auth.login({sso: true})
      .then((auth) => {
        expect(orgStub.called, 'to equal', true)
        expect(urlStub.called, 'to equal', true)
        expect(tokenStub.called, 'to equal', true)
        expect(cli.stderr, 'to equal', 'Opening browser for login... done\ncannot open\n')
        api.done()
        expect(auth, 'to equal', {token: 'token', email: 'foo@bar.com'})
      })
  })

  context('win shells that are not tty', () => {
    it('recommends using cmd.exe on windows', () => {
      stubPrompt.withArgs('Email').returns(Promise.resolve('email'))
      stubPrompt.withArgs('Password', {hide: true}).returns(Promise.reject(new PromptMaskError('CLI needs to prompt for Login but stdin is not a tty.')))
      os.platform = sinon.stub().returns('win32')
      return expect(auth.login(), 'to be rejected with', 'Login is currently incompatible with git bash/Cygwin/MinGW')
    })
  })
})
