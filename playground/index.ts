/* eslint-disable no-console */
/* eslint-disable antfu/no-top-level-await */
import { createGazania } from 'gazania'
import { createClient } from '../src'

const endpoint = 'https://graphql.anilist.co'
const gazania = createGazania(endpoint)

const client = createClient(endpoint)

/**
 * Same to:
 *
 * ```graphql
 * query FetchAnime($id: Int!) {
 *   Media(id: $id, type: ANIME) {
 *     id
 *     title {
 *       romaji
 *       english
 *       native
 *     }
 *   }
 * }
 * ```
 * Learn more: https://gazania.teages.dev/get-started/introduction
 */
const query = gazania.query('FetchAnime')
  .vars({ id: 'Int!' })
  .select(($, vars) => $.select([{
    Media: $ => $.args({ id: vars.id, type: $.enum('ANIME') })
    .select([
      'id',
      {
        title: $ => $.select([
          'romaji',
          'english',
          'native',
        ]),
      },
    ])
  }]))

// @ts-expect-error TODO: fix in gazania
const fetchAnime = client.prepare(query)

const res = await fetchAnime({ id: 127549 })
console.log(res)
