export const DEFAULT_EVENTS = ['created', 'updated', 'patched', 'removed']
export const DEFAULT_METHODS = ['find', 'get', 'create', 'update', 'patch', 'remove']

export function isKoaApp (app) {
  return typeof app.request === 'object' && typeof app.request.query === 'object'
}

export function isExpressApp (app) {
  return typeof app.request === 'object' && typeof app.request.app === 'function'
}

export function isInternalService (app, serviceDescriptor) {
  // Default is to expose all services
  if (!app.distributionOptions.services) return false
  if (typeof app.distributionOptions.services === 'function') return !app.distributionOptions.services(serviceDescriptor)
  else return !app.distributionOptions.services.includes(serviceDescriptor.path)
}

export function isDiscoveredService (app, serviceDescriptor) {
  // Default is to discover all services
  if (!app.distributionOptions.remoteServices) return true
  if (typeof app.distributionOptions.remoteServices === 'function') return app.distributionOptions.remoteServices(serviceDescriptor)
  else return app.distributionOptions.remoteServices.includes(serviceDescriptor.path)
}

export function getServicePath (app, serviceDescriptor) {
  // Default is to same as remote path
  if (!app.distributionOptions.remoteServicePath) return serviceDescriptor.path
  else return app.distributionOptions.remoteServicePath(serviceDescriptor)
}

export function getService (app, path) {
  try {
    return app.service(path)
  } catch {
    // We return a false-y value in case the service wasn't found
    return null
  }
}

export async function healthcheck (app, key) {
  // List all available services
  let services = Object.getOwnPropertyNames(app.services)
  // Filter non-remote ones
  services = services.filter(path => {
    const service = getService(app, path)
    return (service && service.remote && (service.key === key))
  })

  const response = {
    status: 200
  }
  const errors = []
  // Perform all operations in // so that it will speed-up in case of eg timeouts
  await Promise.all(services.map(async path => {
    const service = getService(app, path)
    try {
      await service.healthcheck()
      // For more detail we store the list of failed/successful services
      Object.assign(response, { [service.path]: true })
    } catch (error) {
      errors.push(error)
      response.status = 503
      // For more detail we store the list of failed/successful services
      Object.assign(response, { [service.path]: false })
    }
  }))

  if (errors.length > 0) {
    Object.assign(response, {
      errors: errors.map(error => typeof error.toJSON === 'function' ? error.toJSON() : { message: error.message })
    })
  }
  return response
}
