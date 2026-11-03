import { PortableDoc } from '@portable-doc/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const doc = [{ type: 'heading', level: 1, text: 'Hello PortableDoc' }]
console.log(renderToStaticMarkup(createElement(PortableDoc, { value: doc })))
