/* eslint-disable no-console */
/* eslint-disable antfu/no-top-level-await */
import { useSchema } from '@teages/gqf'
import { createClient } from '../src'

const endpoint = 'https://graphql.anilist.co'
const { gqf, $enum } = useSchema(endpoint)

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
 * Learn more: https://gqf.teages.xyz/guide/first-query.html
 */
const query = gqf('query FetchAnime', {
  id: 'Int!',
}, [{
  Media: $ => $({ id: $.id, type: $enum('ANIME') }, [
    'id',
    {
      title: $ => $([
        'romaji',
        'english',
        'native',
      ]),
    },
  ]),
}])

const fetchAnime = client.prepare(query)

const res = await fetchAnime({ id: 127549 })
console.log(res)
