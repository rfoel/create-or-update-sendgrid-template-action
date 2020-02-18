const core = require('@actions/core')
const github = require('@actions/github');
const { exec } = require('@actions/exec')
const client = require('@sendgrid/client')
const qs = require('qs')
const fs = require('fs')

const context = github.context;
const workspace = process.env.GITHUB_WORKSPACE

client.setApiKey(process.env.SENDGRID_API_KEY)

const getAllTemplates = async page => {
  const params = qs.stringify({
    generations: 'dynamic',
    page_size: 1,
    page_token: page,
  })

  const { result, _metadata: { next } = {} } = await client
    .request({
      method: 'get',
      url: `/v3/templates?${params}`,
    })
    .then(([, data]) => data)

  if (next) {
    const { page_token } = qs.parse(next.split('?')[1])
    return [...result, ...(await getAllTemplates(page_token))]
  }

  return result
}

const getHtml = name => new Promise((resolve, reject) => {
  fs.readFile(`${workspace}/packages/${name}/dist/template.html`, 'utf8', (err, data) => {
    if (err) reject(err)
    resolve(data)
  })
})

const getMetadata = name => new Promise((resolve, reject) => {
  fs.readFile(`${workspace}/packages/${name}/dist/meta.json`, 'utf8', (err, data) => {
    if (err) reject(err)
    resolve(data)
  })
})


const createTemplate = (name) => client
  .request({
    method: 'POST',
    url: '/v3/templates',
    body: {
      name,
      generation: 'dynamic',
    },
  })
  .then(([, data]) => data)

const createTemplateVersion = (id, version, subject, html) => client
  .request({
    method: 'POST',
    url: `/v3/templates/${id}/versions`,
    body: {
      active: 1,
      name: `v${version}`,
      subject,
      html_content: html,
      generate_plain_content: true,
    },
  }).then(([, data]) => data)

const run = async () => {
  try {
    console.log('Will fetch templates from SendGrid')
    const templates = await getAllTemplates()
    console.log(`${templates.length} templates fetched`)
    const [name, version] = context.ref.split('/')[2].split('@')

    const html = await getHtml(name)

    const { subject } = await getMetadata(name).then(JSON.parse)

    let template = templates.find(tmplt => tmplt.name === name)

    if (!template) {
      console.log(`Template ${name} not found`)
      template = await createTemplate(name)
      console.log(`Template ${name} created`)
    }

    console.log(`Generating version ${version} for template ${name}`)
    await createTemplateVersion(template.id, version, subject, html)

    console.log(`Version ${name}@${version} generated successfully`)
  } catch (e) {
    console.log('Something went wrong')
    core.setFailed(e)
  }
}

run()