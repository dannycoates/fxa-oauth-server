/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const crypto = require('crypto');

const assert = require('insist');
const buf = require('buf').hex;
const hex = require('buf').to.hex;

const db = require('../lib/db');
const config = require('../lib/config');

/*global describe,it,before*/

function randomString(len) {
  return crypto.randomBytes(Math.ceil(len)).toString('hex');
}

describe('db', function() {

  describe('#_initialClients', function() {
    it('should not insert already existing clients', function() {
      return db.ping().then(function() {
        return db._initialClients();
      });
    });

    it('should update existing clients', function() {
      var clients = config.get('clients');
      return db.ping().then(function() {
        clients[0].imageUri = 'http://other.domain/foo/bar.png';
        config.set('clients', clients);
        return db._initialClients();
      }).then(function() {
        return db.getClient(clients[0].id);
      }).then(function(c) {
        assert.equal(c.imageUri, clients[0].imageUri);
      });
    });
  });

  describe('utf-8', function() {

    function makeTest(clientId, clientName) {
      return function() {
        var data = {
          id: clientId,
          name: clientName,
          hashedSecret: randomString(32),
          imageUri: 'https://example.domain/logo',
          redirectUri: 'https://example.domain/return?foo=bar',
          trusted: true
        };

        return db.registerClient(data)
          .then(function(c) {
            assert.equal(c.id.toString('hex'), clientId);
            assert.equal(c.name, clientName);
            return db.getClient(c.id);
          })
          .then(function(cli) {
            assert.equal(cli.id.toString('hex'), clientId);
            assert.equal(cli.name, clientName);
            return db.removeClient(clientId);
          })
          .then(function() {
            return db.getClient(clientId)
              .then(function(cli) {
                assert.equal(void 0, cli);
              });
          });
      };
    }

    it('2-byte encoding preserved', makeTest(randomString(8), 'Düsseldorf'));
    it('3-byte encoding preserved', makeTest(randomString(8), '北京')); // Beijing

  });

  describe('getEncodingInfo', function() {
    it('should use utf8', function() {
      if (config.get('db.driver') === 'memory') {
        return assert.ok('getEncodingInfo has no meaning with memory impl');
      }

      return db.getEncodingInfo()
        .then(function(info) {
          /*jshint sub:true*/
          assert.equal(info['character_set_connection'], 'utf8');
          assert.equal(info['character_set_database'], 'utf8');
          assert.equal(info['collation_connection'], 'utf8_unicode_ci');
          assert.equal(info['collation_database'], 'utf8_unicode_ci');
        });
    });
  });

  describe('removeUser', function () {
    var clientId = buf(randomString(8));
    var userId = buf(randomString(16));
    var email = 'a@b.c';
    var scope = ['no-scope'];
    var code = null;
    var token = null;

    before(function() {
      return db.registerClient({
        id: clientId,
        name: 'removeUserTest',
        hashedSecret: randomString(32),
        imageUri: 'https://example.domain/logo',
        redirectUri: 'https://example.domain/return?foo=bar',
        trusted: true
      }).then(function () {
        return db.generateCode(clientId, userId, email, scope, 0);
      }).then(function (c) {
        code = c;
        return db.getCode(code);
      }).then(function(code) {
        assert.equal(hex(code.userId), hex(userId));
        return db.generateToken({
          clientId: clientId,
          userId: userId,
          email: email,
          scope: scope
        });
      }).then(function (t) {
        token = t.token;
        assert.equal(hex(t.userId), hex(userId), 'token userId');
      });
    });

    it('should delete tokens and codes for the given userId', function () {
      return db.removeUser(userId).then(function () {
        return db.getCode(code);
      }).then(function (c) {
        assert.equal(c, undefined, 'code deleted');
        return db.getToken(token);
      }).then(function (t) {
        assert.equal(t, undefined, 'token deleted');
      });
    });
  });

  describe('developers', function () {

    describe('removeDeveloper', function() {
      it('should not fail on non-existent developers', function() {
        return db.removeDeveloper('unknown@developer.com');
      });

      it('should delete developers', function() {
        var email = 'email' + randomString(10) + '@mozilla.com';

        return db.activateDeveloper(email)
          .then(function(developer) {
            assert.equal(developer.email, email);

            return db.removeDeveloper(email);
          })
          .then(function() {
            return db.getDeveloper(email);
          })
          .done(function(developer) {
            assert.equal(developer, null);
          });
      });
    });

    describe('getDeveloper', function() {
      it('should return null if developer does not exit', function() {
        return db.getDeveloper('unknown@developer.com')
          .then(function(developer) {
            assert.equal(developer, null);
          });
      });

      it('should throw on empty email', function() {
        return db.getDeveloper()
          .done(
          assert.fail,
          function(err) {
            assert.equal(err.message, 'Email is required');
          }
        );
      });

    });

    describe('activateDeveloper and getDeveloper', function() {
      it('should create developers', function() {
        var email = 'email' + randomString(10) + '@mozilla.com';

        return db.activateDeveloper(email)
          .done(function(developer) {
            assert.equal(developer.email, email);
          });
      });

      it('should not allow duplicates', function() {
        var email = 'email' + randomString(10) + '@mozilla.com';

        return db.activateDeveloper(email)
          .then(function() {
            return db.activateDeveloper(email);
          })
          .done(
            function() {
              assert.fail();
            },
            function(err) {
              assert.equal(err.message.indexOf('ER_DUP_ENTRY') >= 0, true);
            }
          );
      });

      it('should throw on empty email', function() {
        return db.activateDeveloper()
          .done(
            assert.fail,
            function(err) {
              assert.equal(err.message, 'Email is required');
            }
          );
      });

    });

    describe('registerClientDeveloper and developerOwnsClient', function() {
      var clientId = buf(randomString(8));
      var userId = buf(randomString(16));
      var email = 'a@b.c';
      var scope = ['no-scope'];
      var code = null;
      var token = null;

      before(function() {
        return db.registerClient({
          id: clientId,
          name: 'registerClientDeveloper',
          hashedSecret: randomString(32),
          imageUri: 'https://example.domain/logo',
          redirectUri: 'https://example.domain/return?foo=bar',
          trusted: true
        }).then(function() {
          return db.generateCode(clientId, userId, email, scope, 0);
        }).then(function(c) {
          code = c;
          return db.getCode(code);
        }).then(function(code) {
          assert.equal(hex(code.userId), hex(userId));
          return db.generateToken({
            clientId: clientId,
            userId: userId,
            email: email,
            scope: scope
          });
        }).then(function(t) {
          token = t.token;
          assert.equal(hex(t.userId), hex(userId), 'token userId');
        });
      });

      it('should attach a developer to a client', function(done) {
        var email = 'email' + randomString(10) + '@mozilla.com';

        return db.activateDeveloper(email)
          .then(function(developer) {
            return db.registerClientDeveloper(
              hex(developer.developerId),
              hex(clientId)
            );
          })
          .then(function() {
            return db.getClientDevelopers(hex(clientId));
          })
          .done(function(developers) {
            if (developers) {
              var found = false;

              developers.forEach(function(developer) {
                if (developer.email === email) {
                  found = true;
                }
              });

              assert.equal(found, true);
              return done();
            }
          }, done);

      });

    });

  });

});
