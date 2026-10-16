# Marketplace automation

The publisher is `Kogler7`. Authentication uses the Entra application
`OpenCML-Ext-Publisher` and GitHub OIDC; no Azure subscription, PAT or client secret
is used. The client/tenant IDs in the workflow are public identity identifiers.

## One-time setup

In the application's **Certificates & secrets → Federated credentials**, add a
credential with the GitHub Actions scenario:

| Field | Value |
| --- | --- |
| Organization | `OpenCML` |
| Repository | `OpenCML-Ext` |
| Entity type | Environment |
| Environment | `marketplace` |
| Name | `github-marketplace` |
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject | `repo:OpenCML/OpenCML-Ext:environment:marketplace` |
| Audience | `api://AzureADTokenExchange` |

In GitHub repository settings, create the **marketplace** environment. Deployment
rules must allow the bootstrap run on `wzj-dev` and subsequent `v*` release tags.
If GitHub requires environment approval, approve the identity-check run there.

The first push of `publish.yml` on `wzj-dev` starts an identity-only run. After
configuring federation, re-run that job from GitHub Actions if necessary. Manual
runs also verify identity only, once this workflow exists on the default branch.

Read **Marketplace identity ID** from the job summary. In the Marketplace
`Kogler7` publisher's **Members** page, add that identity as a **Contributor**.
Use the ID returned by the profile API, not the application's client ID or the
application object's ID. These identify different objects.

## Release

1. Update `package.json`, `package-lock.json` and `CHANGELOG.md`, test and commit.
2. Push a version tag matching the committed manifest, for example `v1.8.2` for
   manifest version `1.8.2`. A tag uses the workflow at its target commit.
3. CI runs extension-only checks, builds and uploads a VSIX artifact. The publish
   job authenticates without an Azure subscription and publishes that artifact.
4. On success the same VSIX is attached to a GitHub Release. Re-running a completed
   version skips its duplicate Marketplace upload and repairs the release asset.

Ordinary branch pushes run CI but do not publish. Editing `publish.yml` on
`wzj-dev` additionally checks the publishing identity. No version tag is created
automatically. Do not reuse a published version for changed source contents.

CI checks TextMate grammar, i18n, compatibility behavior, tool discovery, GIR
helpers, TypeScript and the complete extension build. It does not claim to run
native Camel LSP/debugger integration tests: those need a separately built Camel
runtime. Run them locally before tagging a release that changes those integrations.

References:

- [Entra GitHub federated credentials](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust)
- [Azure login without subscriptions](https://github.com/Azure/login#login-without-subscription)
- [Marketplace service principal membership](https://learn.microsoft.com/en-us/azure/devops/extend/publish/command-line#publish-with-a-microsoft-entra-token)
- [VS Code publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
