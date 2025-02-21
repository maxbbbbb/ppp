import { css } from '../../shared/element/styles/css.js';
import { widgetStyles } from './widget.js';
import {
  orderWidgetTemplate,
  widgetDefinition as baseWidgetDefinition
} from '../../shared/order-widget.js';

// noinspection JSUnusedGlobalSymbols
export async function widgetDefinition({ ppp, baseWidgetUrl }) {
  const orderWidgetStyles = (context, definition) => css`
    .price-placeholder {
      position: absolute;
      z-index: 2;
    }

    ${widgetStyles}
  `;

  return baseWidgetDefinition({
    template: orderWidgetTemplate,
    styles: orderWidgetStyles,
    shadowOptions: null
  });
}
