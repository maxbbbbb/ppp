import { Page, PageWithService, PageWithSupabaseService } from './page.js';
import { validate } from './validate.js';
import { Tmpl } from './tmpl.js';
import { SERVICE_STATE, SERVICES } from './const.js';
import { applyMixins } from './utilities/apply-mixins.js';
import { uuidv4 } from './ppp-crypto.js';
import ppp from '../ppp.js';

export class ServiceNyseNsdqHaltsPage extends Page {
  collection = 'services';

  async sendTestNyseNsdqHaltMessage() {
    this.beginOperation();

    try {
      await validate(this.supabaseApiId);
      await validate(this.botId);
      await validate(this.channel);
      await validate(this.formatterCode);

      const temporaryFormatterName = `ppp_${uuidv4().replaceAll('-', '_')}`;

      // Returns form data
      const temporaryFormatterBody = `function ${temporaryFormatterName}(halt_date,
        halt_time, symbol, name, market, reason_code, pause_threshold_price,
        resumption_date, resumption_quote_time, resumption_trade_time) {
          const closure = () => {${this.formatterCode.value}};
          const formatted = closure();

          if (typeof formatted === 'string')
            return \`chat_id=${this.channel.value}&text=\${formatted}&parse_mode=html\`;
          else {
            const options = formatted.options || {};
            let formData = \`chat_id=${this.channel.value}&text=\${formatted.text}\`;

            if (typeof options.parse_mode === 'undefined')
              formData += '&parse_mode=html';

            if (typeof options.entities !== 'undefined')
              formData += \`&entities=\${encodeURIComponent(options.entities)}\`;

            if (options.disable_web_page_preview === true)
              formData += '&disable_web_page_preview=true';

            if (options.disable_notification === true)
              formData += '&disable_notification=true';

            if (options.protect_content === true)
              formData += '&protect_content=true';

            if (typeof options.reply_markup !== 'undefined')
              formData += \`&reply_markup=\${encodeURIComponent(options.reply_markup)}\`;

            return formData;
          }
        }`;

      const functionBody = `${temporaryFormatterBody}
         return plv8.execute(\`select content from http_post('https://api.telegram.org/bot${
           this.botId.datum().token
         }/sendMessage',
        '\${${temporaryFormatterName}('02/10/2022', '15:37:48', 'ASTR', 'Astra Space Inc Cl A Cmn Stk', 'NASDAQ', 'LUDP',
          '', '02/10/2022', '15:37:48', '15:42:48')}',
        'application/x-www-form-urlencoded')\`);`;

      await this.callTemporaryFunction({
        api: this.supabaseApiId.datum(),
        functionBody
      });

      this.succeedOperation('Сообщение отправлено.');
    } catch (e) {
      this.failOperation(e);
    } finally {
      this.endOperation();
    }
  }

  async callSymbolsFunction(returnResult) {
    this.beginOperation();

    try {
      await validate(this.supabaseApiId);
      await validate(this.symbolsCode);

      const result = await this.callTemporaryFunction({
        api: this.supabaseApiId.datum(),
        functionBody: this.symbolsCode.value,
        returnResult
      });

      if (!returnResult)
        this.succeedOperation(
          'База данных выполнила функцию успешно. Смотрите результат в консоли браузера.'
        );

      return result;
    } catch (e) {
      this.failOperation(e);
    } finally {
      this.endOperation();
    }
  }

  async #deploy() {
    if (!this.document.supabaseApi)
      this.document.supabaseApi = this.supabaseApiId.datum();

    if (!this.document.bot) this.document.bot = this.botId.datum();

    const [sendTelegramMessage, deployNyseNsdqHalts] = await Promise.all([
      fetch(this.getSQLUrl('send-telegram-message.sql')).then((r) => r.text()),
      fetch(this.getSQLUrl(`${SERVICES.NYSE_NSDQ_HALTS}/deploy.sql`)).then(
        (r) => r.text()
      )
    ]);

    this.document.symbols = JSON.stringify(
      await this.callSymbolsFunction(true)
    );

    const query = `${sendTelegramMessage}
      ${await new Tmpl().render(this, deployNyseNsdqHalts, {})}`;

    await this.executeSQL({
      api: this.document.supabaseApi,
      query: await new Tmpl().render(this, query, {})
    });
  }

  async validate() {
    await validate(this.name);
    await validate(this.supabaseApiId);
    await validate(this.interval);
    await validate(this.interval, {
      hook: async (value) => +value > 0 && +value <= 1000,
      errorMessage: 'Введите значение в диапазоне от 1 до 1000'
    });
    await validate(this.depth);
    await validate(this.depth, {
      hook: async (value) => +value >= 30 && +value <= 10000,
      errorMessage: 'Введите значение в диапазоне от 30 до 10000'
    });
    await validate(this.symbolsCode);
    await validate(this.botId);
    await validate(this.channel);
    await validate(this.formatterCode);
  }

  async read() {
    return (context) => {
      return context.services
        .get('mongodb-atlas')
        .db('ppp')
        .collection('[%#this.page.view.collection%]')
        .aggregate([
          {
            $match: {
              _id: new BSON.ObjectId('[%#payload.documentId%]'),
              type: `[%#(await import('./const.js')).SERVICES.NYSE_NSDQ_HALTS%]`
            }
          },
          {
            $lookup: {
              from: 'apis',
              localField: 'supabaseApiId',
              foreignField: '_id',
              as: 'supabaseApi'
            }
          },
          {
            $unwind: '$supabaseApi'
          },
          {
            $lookup: {
              from: 'bots',
              localField: 'botId',
              foreignField: '_id',
              as: 'bot'
            }
          },
          {
            $unwind: '$bot'
          }
        ]);
    };
  }

  async find() {
    return {
      type: SERVICES.NYSE_NSDQ_HALTS,
      name: this.name.value.trim()
    };
  }

  async update() {
    const state =
      this.document.state === SERVICE_STATE.ACTIVE
        ? SERVICE_STATE.ACTIVE
        : SERVICE_STATE.STOPPED;

    return [
      {
        $set: {
          name: this.name.value.trim(),
          supabaseApiId: this.supabaseApiId.value,
          interval: Math.ceil(Math.abs(this.interval.value)),
          depth: Math.ceil(Math.abs(this.depth.value)),
          symbolsCode: this.symbolsCode.value,
          botId: this.botId.value,
          channel: +this.channel.value,
          formatterCode: this.formatterCode.value,
          version: 1,
          state: SERVICE_STATE.FAILED,
          updatedAt: new Date()
        },
        $setOnInsert: {
          type: SERVICES.NYSE_NSDQ_HALTS,
          createdAt: new Date()
        }
      },
      this.#deploy,
      () => ({
        $set: {
          state,
          updatedAt: new Date()
        }
      })
    ];
  }
}

applyMixins(ServiceNyseNsdqHaltsPage, PageWithService, PageWithSupabaseService);
