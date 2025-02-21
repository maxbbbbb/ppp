import { Page } from './page.js';
import { validate, invalidate } from './validate.js';
import { maybeFetchError } from './fetch-error.js';
import { bufferToString, generateIV } from './ppp-crypto.js';
import { TAG } from './tag.js';
import { requireComponent } from './template.js';
import ppp from '../ppp.js';

export async function checkGitHubToken({ token }) {
  return fetch('https://api.github.com/user', {
    cache: 'no-cache',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${token}`
    }
  });
}

export async function checkMongoDBRealmCredentials({
  serviceMachineUrl,
  publicKey,
  privateKey
}) {
  return fetch(new URL('fetch', serviceMachineUrl).toString(), {
    cache: 'no-cache',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: 'https://realm.mongodb.com/api/admin/v3.0/auth/providers/mongodb-cloud/login',
      body: {
        username: publicKey,
        apiKey: privateKey
      }
    })
  });
}

export async function getCloudCredentialsFuncSource() {
  const iv = generateIV();
  const cipherText = await ppp.crypto.encrypt(
    iv,
    JSON.stringify({
      'github-login': ppp.keyVault.getKey('github-login'),
      'github-token': ppp.keyVault.getKey('github-token'),
      'mongo-api-key': ppp.keyVault.getKey('mongo-api-key'),
      'mongo-app-client-id': ppp.keyVault.getKey('mongo-app-client-id'),
      'mongo-app-id': ppp.keyVault.getKey('mongo-app-id'),
      'mongo-group-id': ppp.keyVault.getKey('mongo-group-id'),
      'mongo-private-key': ppp.keyVault.getKey('mongo-private-key'),
      'mongo-public-key': ppp.keyVault.getKey('mongo-public-key'),
      'service-machine-url': ppp.keyVault.getKey('service-machine-url'),
      tag: TAG
    })
  );

  return `exports = function () {
      return {
        iv: '${bufferToString(iv)}', data: '${cipherText}'
      };
    };`;
}

export async function createCloudCredentialsEndpoint({
  serviceMachineUrl,
  mongoDBRealmAccessToken,
  functionList
}) {
  const groupId = ppp.keyVault.getKey('mongo-group-id');
  const appId = ppp.keyVault.getKey('mongo-app-id');

  let cloudCredentialsFuncId;

  const func = functionList?.find((f) => f.name === 'cloudCredentials');

  if (func) {
    cloudCredentialsFuncId = func._id;

    const rUpdateFunc = await fetch(
      new URL('fetch', serviceMachineUrl).toString(),
      {
        cache: 'no-cache',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'PUT',
          url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${appId}/functions/${func._id}`,
          headers: {
            Authorization: `Bearer ${mongoDBRealmAccessToken}`
          },
          body: JSON.stringify({
            name: 'cloudCredentials',
            source: await getCloudCredentialsFuncSource(),
            run_as_system: true
          })
        })
      }
    );

    await maybeFetchError(rUpdateFunc);
  } else {
    const rCreateFunc = await fetch(
      new URL('fetch', serviceMachineUrl).toString(),
      {
        cache: 'no-cache',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'POST',
          url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${appId}/functions`,
          headers: {
            Authorization: `Bearer ${mongoDBRealmAccessToken}`
          },
          body: JSON.stringify({
            name: 'cloudCredentials',
            source: await getCloudCredentialsFuncSource(),
            run_as_system: true
          })
        })
      }
    );

    await maybeFetchError(rCreateFunc);

    const jCreateFunc = await rCreateFunc.json();

    cloudCredentialsFuncId = jCreateFunc._id;
  }

  const rNewEndpoint = await fetch(
    new URL('fetch', serviceMachineUrl).toString(),
    {
      cache: 'no-cache',
      method: 'POST',
      body: JSON.stringify({
        method: 'POST',
        url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${appId}/endpoints`,
        body: {
          route: '/cloud_credentials',
          function_name: 'cloudCredentials',
          function_id: cloudCredentialsFuncId,
          http_method: 'GET',
          validation_method: 'NO_VALIDATION',
          secret_id: '',
          secret_name: '',
          create_user_on_auth: false,
          fetch_custom_user_data: false,
          respond_result: true,
          disabled: false
        },
        headers: {
          Authorization: `Bearer ${mongoDBRealmAccessToken}`
        }
      })
    }
  );

  // Conflict is OK
  if (rNewEndpoint.status !== 409) await maybeFetchError(rNewEndpoint);
}

export class CloudServicesPage extends Page {
  async handleImportCloudKeysClick() {
    await requireComponent('ppp-modal');
    await requireComponent('ppp-import-cloud-keys-modal-page');

    this.importCloudKeysModal.visible = true;
  }

  generateCloudCredentialsString() {
    return btoa(
      JSON.stringify({
        s: ppp.keyVault.getKey('service-machine-url'),
        u:
          ppp.keyVault
            .getKey('mongo-location-url')
            .replace('aws.stitch.mongodb', 'aws.data.mongodb-api') +
          `/app/${ppp.keyVault.getKey(
            'mongo-app-client-id'
          )}/endpoint/cloud_credentials`
      })
    );
  }

  async #createServerlessFunctions({
    serviceMachineUrl,
    mongoDBRealmAccessToken
  }) {
    const groupId = ppp.keyVault.getKey('mongo-group-id');
    const appId = ppp.keyVault.getKey('mongo-app-id');
    const funcs = [
      { name: 'eval', path: 'functions/mongodb/eval.js' },
      { name: 'aggregate', path: 'functions/mongodb/aggregate.js' },
      { name: 'bulkWrite', path: 'functions/mongodb/bulk-write.js' },
      { name: 'count', path: 'functions/mongodb/count.js' },
      { name: 'deleteMany', path: 'functions/mongodb/delete-many.js' },
      { name: 'deleteOne', path: 'functions/mongodb/delete-one.js' },
      { name: 'distinct', path: 'functions/mongodb/distinct.js' },
      { name: 'find', path: 'functions/mongodb/find.js' },
      { name: 'findOne', path: 'functions/mongodb/find-one.js' },
      {
        name: 'findOneAndDelete',
        path: 'functions/mongodb/find-one-and-delete.js'
      },
      {
        name: 'findOneAndReplace',
        path: 'functions/mongodb/find-one-and-replace.js'
      },
      {
        name: 'findOneAndUpdate',
        path: 'functions/mongodb/find-one-and-update.js'
      },
      { name: 'insertMany', path: 'functions/mongodb/insert-many.js' },
      { name: 'insertOne', path: 'functions/mongodb/insert-one.js' },
      { name: 'updateMany', path: 'functions/mongodb/update-many.js' },
      { name: 'updateOne', path: 'functions/mongodb/update-one.js' }
    ];

    const rFunctionList = await fetch(
      new URL('fetch', serviceMachineUrl).toString(),
      {
        cache: 'no-cache',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'GET',
          url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${appId}/functions`,
          headers: {
            Authorization: `Bearer ${mongoDBRealmAccessToken}`
          }
        })
      }
    );

    await maybeFetchError(rFunctionList);
    this.progressOperation(30);

    const functionList = await rFunctionList.json();

    for (const f of functionList) {
      if (funcs.find((fun) => fun.name === f.name)) {
        const rRemoveFunc = await fetch(
          new URL('fetch', serviceMachineUrl).toString(),
          {
            cache: 'no-cache',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              method: 'DELETE',
              url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${appId}/functions/${f._id}`,
              headers: {
                Authorization: `Bearer ${mongoDBRealmAccessToken}`
              }
            })
          }
        );

        await maybeFetchError(rRemoveFunc);

        ppp.app.toast.progress.value += Math.floor(30 / funcs.length);
      }
    }

    for (const f of funcs) {
      let source;

      if (f.path) {
        const sourceRequest = await fetch(
          new URL(f.path, window.location.origin + window.location.pathname)
        );

        source = await sourceRequest.text();
      } else if (typeof f.source === 'function') {
        source = await f.source();
      }

      const rCreateFunc = await fetch(
        new URL('fetch', serviceMachineUrl).toString(),
        {
          cache: 'no-cache',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            method: 'POST',
            url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${appId}/functions`,
            headers: {
              Authorization: `Bearer ${mongoDBRealmAccessToken}`
            },
            body: JSON.stringify({
              name: f.name,
              source,
              run_as_system: true
            })
          })
        }
      );

      await maybeFetchError(rCreateFunc);

      ppp.app.toast.progress.value += Math.floor(30 / funcs.length);
    }

    this.progressOperation(95, 'Сохранение ключей облачных сервисов');

    await createCloudCredentialsEndpoint({
      serviceMachineUrl,
      mongoDBRealmAccessToken,
      functionList
    });
  }

  async #setUpMongoDBRealmApp({ serviceMachineUrl, mongoDBRealmAccessToken }) {
    // 1. Get Group (Project) ID
    const rProjectId = await fetch(
      new URL('fetch', serviceMachineUrl).toString(),
      {
        cache: 'no-cache',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'GET',
          url: 'https://realm.mongodb.com/api/admin/v3.0/auth/profile',
          headers: {
            Authorization: `Bearer ${mongoDBRealmAccessToken}`
          }
        })
      }
    );

    await maybeFetchError(rProjectId);
    this.progressOperation(5, 'Поиск проекта ppp в MongoDB Realm');

    const { roles } = await rProjectId.json();

    // TODO - will fail if a user has multiple projects
    const groupId = roles?.find((r) => r.role_name === 'GROUP_OWNER')?.group_id;

    if (groupId) {
      ppp.keyVault.setKey('mongo-group-id', groupId);
    } else {
      invalidate(ppp.app.toast, {
        errorMessage: 'Проект ppp не найден в MongoDB Realm.',
        raiseException: true
      });
    }

    // 2. Get App Client ID
    const rAppId = await fetch(new URL('fetch', serviceMachineUrl).toString(), {
      cache: 'no-cache',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        method: 'GET',
        url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps`,
        headers: {
          Authorization: `Bearer ${mongoDBRealmAccessToken}`
        }
      })
    });

    await maybeFetchError(rAppId);
    this.progressOperation(10);

    const apps = await rAppId.json();
    const pppApp = apps?.find((a) => a.name === 'ppp');

    if (pppApp) {
      ppp.keyVault.setKey('mongo-app-client-id', pppApp.client_app_id);
      ppp.keyVault.setKey('mongo-app-id', pppApp._id);
    } else {
      invalidate(ppp.app.toast, {
        errorMessage: 'Приложение ppp не найдено в MongoDB Realm.',
        raiseException: true
      });
    }

    // 3. Create & enable API Key provider
    const rAuthProviders = await fetch(
      new URL('fetch', serviceMachineUrl).toString(),
      {
        cache: 'no-cache',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'GET',
          url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${pppApp._id}/auth_providers`,
          headers: {
            Authorization: `Bearer ${mongoDBRealmAccessToken}`
          }
        })
      }
    );

    await maybeFetchError(
      rAuthProviders,
      'Не удалось получить список провайдеров авторизации MongoDB Realm.'
    );
    this.progressOperation(
      15,
      'Создание API-ключа пользователя в MongoDB Realm'
    );

    const providers = await rAuthProviders.json();
    const apiKeyProvider = providers.find((p) => (p.type = 'api-key'));

    if (apiKeyProvider && apiKeyProvider.disabled) {
      const rEnableAPIKeyProvider = await fetch(
        new URL('fetch', serviceMachineUrl).toString(),
        {
          cache: 'no-cache',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            method: 'PUT',
            url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${pppApp._id}/auth_providers/${apiKeyProvider._id}/enable`,
            headers: {
              Authorization: `Bearer ${mongoDBRealmAccessToken}`
            }
          })
        }
      );

      await maybeFetchError(
        rEnableAPIKeyProvider,
        'Не удалось активировать провайдера API-ключей MongoDB Realm.'
      );
    }

    if (!apiKeyProvider) {
      const rCreateAPIKeyProvider = await fetch(
        new URL('fetch', serviceMachineUrl).toString(),
        {
          cache: 'no-cache',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            method: 'POST',
            url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${pppApp._id}/auth_providers`,
            headers: {
              Authorization: `Bearer ${mongoDBRealmAccessToken}`
            },
            body: JSON.stringify({
              name: 'api-key',
              type: 'api-key',
              disabled: false
            })
          })
        }
      );

      await maybeFetchError(
        rCreateAPIKeyProvider,
        'Не удалось подключить провайдера API-ключей MongoDB Realm.'
      );
    }

    // 4. Create an API Key
    const rCreateAPIKey = await fetch(
      new URL('fetch', serviceMachineUrl).toString(),
      {
        cache: 'no-cache',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'POST',
          url: `https://realm.mongodb.com/api/admin/v3.0/groups/${groupId}/apps/${pppApp._id}/api_keys`,
          headers: {
            Authorization: `Bearer ${mongoDBRealmAccessToken}`
          },
          body: JSON.stringify({
            name: `ppp-${Date.now()}`
          })
        })
      }
    );

    await maybeFetchError(
      rCreateAPIKey,
      'Не удалось создать API-ключ пользователя MongoDB Realm.'
    );
    this.progressOperation(25, 'Запись облачных функций');
    ppp.keyVault.setKey('mongo-api-key', (await rCreateAPIKey.json()).key);

    // 5. Create serverless functions
    await this.#createServerlessFunctions({
      serviceMachineUrl,
      mongoDBRealmAccessToken
    });
  }

  async save() {
    this.beginOperation();

    try {
      await validate(this.masterPassword);
      await validate(this.serviceMachineUrl);
      await validate(this.gitHubToken);
      await validate(this.mongoPublicKey);
      await validate(this.mongoPrivateKey);

      localStorage.removeItem('ppp-mongo-location-url');
      sessionStorage.removeItem('realmLogin');
      ppp.keyVault.setKey('tag', TAG);
      ppp.keyVault.setKey('master-password', this.masterPassword.value.trim());

      let serviceMachineUrl;

      // Check service machine URL
      try {
        if (!this.serviceMachineUrl.value.trim().startsWith('https://'))
          this.serviceMachineUrl.value =
            'https://' + this.serviceMachineUrl.value.trim();

        serviceMachineUrl = new URL(
          'ping',
          this.serviceMachineUrl.value.trim()
        );

        const rs = await fetch(serviceMachineUrl.toString());
        const rst = await rs.text();

        if (rst !== 'pong') {
          invalidate(this.serviceMachineUrl, {
            errorMessage: 'Неверный URL',
            raiseException: true
          });
        }
      } catch (e) {
        invalidate(this.serviceMachineUrl, {
          errorMessage: 'Неверный или неполный URL',
          raiseException: true
        });
      }

      ppp.keyVault.setKey('service-machine-url', serviceMachineUrl.origin);

      // 1. Check GitHub token, store repo owner
      const rGitHub = await checkGitHubToken({
        token: this.gitHubToken.value.trim()
      });

      if (!rGitHub.ok) {
        invalidate(this.gitHubToken, {
          errorMessage: 'Неверный токен',
          raiseException: true
        });
      }

      ppp.keyVault.setKey('github-login', (await rGitHub.json()).login);
      ppp.keyVault.setKey('github-token', this.gitHubToken.value.trim());

      // 2. Check MongoDB Realm admin credentials, get the access_token
      const rMongoDBRealmCredentials = await checkMongoDBRealmCredentials({
        serviceMachineUrl: serviceMachineUrl.origin,
        publicKey: this.mongoPublicKey.value.trim(),
        privateKey: this.mongoPrivateKey.value.trim()
      });

      if (!rMongoDBRealmCredentials.ok) {
        invalidate(this.mongoPrivateKey, {
          errorMessage: 'Неверная пара ключей MongoDB Realm',
          raiseException: true
        });
      }

      ppp.keyVault.setKey('mongo-public-key', this.mongoPublicKey.value.trim());
      ppp.keyVault.setKey(
        'mongo-private-key',
        this.mongoPrivateKey.value.trim()
      );

      const { access_token: mongoDBRealmAccessToken } =
        await rMongoDBRealmCredentials.json();

      this.progressOperation(0, 'Настройка приложения MongoDB Realm');

      // 3. Create a MongoDB realm API key, set up cloud functions
      await this.#setUpMongoDBRealmApp({
        serviceMachineUrl: serviceMachineUrl.origin,
        mongoDBRealmAccessToken
      });

      this.succeedOperation(
        'Операция успешно выполнена. Обновите страницу, чтобы пользоваться приложением'
      );
    } catch (e) {
      this.failOperation(e);
    } finally {
      this.endOperation();
    }
  }
}
